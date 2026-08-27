import assert from "node:assert/strict"
import fs from "node:fs/promises"
import { after, describe, it } from "node:test"

import { Registry } from "../src/registry.ts"
import { type AgentRouting, MeshError } from "../src/types.ts"
import { tempHome, testConfig } from "./helpers.ts"

const homes: string[] = []
after(async () => {
  for (const home of homes) await fs.rm(home, { recursive: true, force: true })
})

async function newRegistry(overrides = {}) {
  const home = await tempHome()
  homes.push(home)
  return new Registry(testConfig(home, overrides))
}

function routing(sessionID: string, directory = "/tmp/project"): AgentRouting {
  return { sessionID, directory, worktree: directory, serverUrl: "http://127.0.0.1:4096" }
}

describe("registry", () => {
  it("registers and reads back an agent", async () => {
    const registry = await newRegistry()
    await registry.register({
      id: "planner",
      description: "plans work",
      metadata: { stack: "python" },
      routing: routing("ses_1"),
    })
    const entry = await registry.get("planner")
    assert.equal(entry?.record.description, "plans work")
    assert.equal(entry?.record.metadata["stack"], "python")
    assert.equal(entry?.status, "alive")
  })

  it("rejects ids that are not safe slugs", async () => {
    const registry = await newRegistry()
    for (const id of ["A", "has space", "../escape", "x", ""]) {
      await assert.rejects(
        registry.register({ id, description: "d", routing: routing("ses_1") }),
        (error: MeshError) => error.code === "E_INVALID_ID",
      )
    }
  })

  it("is idempotent for the same session and keeps registeredAt", async () => {
    const registry = await newRegistry()
    const first = await registry.register({ id: "planner", description: "v1", routing: routing("ses_1") })
    const second = await registry.register({ id: "planner", description: "v2", routing: routing("ses_1") })
    assert.equal(second.registeredAt, first.registeredAt)
    assert.equal(second.description, "v2")
  })

  it("refuses to steal an id from a live agent, unless forced", async () => {
    const registry = await newRegistry()
    await registry.register({ id: "planner", description: "first", routing: routing("ses_1") })
    await assert.rejects(
      registry.register({ id: "planner", description: "second", routing: routing("ses_2") }),
      (error: MeshError) => error.code === "E_CONFLICT",
    )
    const forced = await registry.register({
      id: "planner",
      description: "second",
      routing: routing("ses_2"),
      force: true,
    })
    assert.equal(forced.routing.sessionID, "ses_2")
  })

  it("lets a new session take over an id whose owner went stale", async () => {
    const registry = await newRegistry({ staleAfterMs: 0 })
    await registry.register({ id: "planner", description: "first", routing: routing("ses_1") })
    const taken = await registry.register({
      id: "planner",
      description: "second",
      routing: routing("ses_2"),
    })
    assert.equal(taken.routing.sessionID, "ses_2")
  })

  it("drops the old record when a session re-registers under a new id", async () => {
    const registry = await newRegistry()
    await registry.register({ id: "planner", description: "d", routing: routing("ses_1") })
    await registry.register({ id: "architect", description: "d", routing: routing("ses_1") })
    assert.equal(await registry.get("planner"), undefined)
    assert.ok(await registry.get("architect"))
  })

  it("marks an agent stale once its heartbeat stops", async () => {
    const registry = await newRegistry({ staleAfterMs: 0 })
    await registry.register({ id: "planner", description: "d", routing: routing("ses_1") })
    assert.equal((await registry.get("planner"))?.status, "stale")
  })

  it("marks an agent stale when its process is gone, even if fresh", async () => {
    const registry = await newRegistry()
    await registry.register({ id: "planner", description: "d", routing: routing("ses_1") })
    const file = registry.recordPath("planner")
    const record = JSON.parse(await fs.readFile(file, "utf8"))
    // A pid that cannot exist: liveness must not depend on mtime alone.
    await fs.writeFile(file, JSON.stringify({ ...record, pid: 2 ** 30 }))
    assert.equal((await registry.get("planner"))?.status, "stale")
  })

  it("allocates a suffixed id when the plain one is taken by a live peer", async () => {
    const registry = await newRegistry()
    await registry.register({ id: "web", description: "d", routing: routing("ses_1") })
    assert.equal(await registry.allocateId("web", "ses_2"), "web-2")
    // ...but the same session keeps its own id.
    assert.equal(await registry.allocateId("web", "ses_1"), "web")
  })

  it("reaps records that expired and leaves fresh ones alone", async () => {
    const registry = await newRegistry({ expireAfterMs: 0 })
    await registry.register({ id: "gone", description: "d", routing: routing("ses_1") })
    assert.deepEqual(await registry.reap(), ["gone"])
    assert.equal(await registry.get("gone"), undefined)

    const keeper = await newRegistry({ expireAfterMs: 60_000 })
    await keeper.register({ id: "here", description: "d", routing: routing("ses_1") })
    assert.deepEqual(await keeper.reap(), [])
  })

  it("ignores unparseable files instead of failing discovery", async () => {
    const registry = await newRegistry()
    await registry.register({ id: "good", description: "d", routing: routing("ses_1") })
    await fs.writeFile(registry.recordPath("broken"), "{ not json")
    const listed = (await registry.list()).map((entry) => entry.record.id)
    assert.deepEqual(listed, ["good"])
  })
})
