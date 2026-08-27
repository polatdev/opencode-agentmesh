import assert from "node:assert/strict"
import { describe, it } from "node:test"

import { parseEnvelope, renderEnvelope } from "../src/envelope.ts"
import type { MeshMessage } from "../src/types.ts"

const base: MeshMessage = {
  id: "agm_01ARZ3NDEKTSV4RRFFQ69G5FAV",
  from: "planner",
  to: "reviewer",
  text: "Please review src/auth.ts against the contract we agreed.",
  sentAt: "2026-08-27T09:12:03.482Z",
}

describe("envelope", () => {
  it("renders header, body and reply footer", () => {
    const rendered = renderEnvelope(base)
    assert.equal(
      rendered.split("\n")[0],
      "[agentmesh] from: planner | 2026-08-27T09:12:03Z | msg: agm_01ARZ3NDEKTSV4RRFFQ69G5FAV",
    )
    assert.ok(rendered.endsWith('(end of agentmesh message; to reply, call agentmesh_send with to "planner")'))
  })

  it("includes the context tag only when given", () => {
    assert.ok(!renderEnvelope(base).includes(" | re: "))
    assert.ok(renderEnvelope({ ...base, context: "T-001 contract" }).includes("| re: T-001 contract"))
  })

  it("round-trips through the parser", () => {
    const parsed = parseEnvelope(renderEnvelope({ ...base, context: "T-001" }))
    assert.equal(parsed["from"], "planner")
    assert.equal(parsed["msg"], base.id)
    assert.equal(parsed["re"], "T-001")
    assert.equal(parsed["text"], base.text)
  })

  it("keeps multi-line bodies intact", () => {
    const text = "line one\nline two\n\nline four"
    assert.equal(parseEnvelope(renderEnvelope({ ...base, text }))["text"], text)
  })

  it("returns nothing for text that is not an envelope", () => {
    assert.deepEqual(parseEnvelope("just a normal user message"), {})
  })
})
