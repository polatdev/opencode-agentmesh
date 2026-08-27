import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"

import { type MeshConfig, resolveConfig } from "../src/config.ts"
import { Mesh, type SessionContext } from "../src/mesh.ts"

export async function tempHome(): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), "agentmesh-test-"))
}

export function testConfig(home: string, overrides: Partial<MeshConfig> = {}): MeshConfig {
  return {
    ...resolveConfig({ home }),
    heartbeatIntervalMs: 60_000,
    pollIntervalMs: 50,
    ackWaitMs: 2_000,
    ...overrides,
  }
}

export type Injected = { sessionID: string; text: string }

/** A mesh whose "session" is just an array we can assert on. */
export function testMesh(config: MeshConfig): { mesh: Mesh; injected: Injected[] } {
  const injected: Injected[] = []
  const mesh = new Mesh(config, {
    log: () => {},
    async inject({ sessionID, text }) {
      injected.push({ sessionID, text })
    },
  })
  return { mesh, injected }
}

export function sessionContext(sessionID: string, directory: string): SessionContext {
  return { sessionID, directory, worktree: directory, serverUrl: "http://127.0.0.1:4096" }
}

export async function waitFor(
  predicate: () => boolean | Promise<boolean>,
  timeoutMs = 3_000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs
  for (;;) {
    if (await predicate()) return
    if (Date.now() >= deadline) throw new Error("condition not met within timeout")
    await new Promise((resolve) => setTimeout(resolve, 20))
  }
}
