/**
 * Rendering of the text that gets injected into the recipient's session.
 *
 *   [agentmesh] from: planner | 2026-08-27T09:12:03Z | msg: agm_01J… | re: T-001
 *   <text>
 *   (end of agentmesh message; to reply, call agentmesh_send with to "planner")
 *
 * The `re:` segment appears only when the sender passed a context tag. The
 * `msg:` id is the correlation key and keeps logs greppable.
 */

import { TOOL_SEND } from "./config.ts"
import type { MeshMessage } from "./types.ts"

export const MAX_CONTEXT_LENGTH = 200

export function renderEnvelope(message: MeshMessage): string {
  const timestamp = message.sentAt.replace(/\.\d+Z$/, "Z")
  let header = `[agentmesh] from: ${message.from} | ${timestamp} | msg: ${message.id}`
  if (message.context) header += ` | re: ${message.context.slice(0, MAX_CONTEXT_LENGTH)}`
  const footer = `to reply, call ${TOOL_SEND} with to "${message.from}"`
  return `${header}\n${message.text}\n(end of agentmesh message; ${footer})`
}

/** Best-effort inverse of {@link renderEnvelope}, for tests and tooling. */
export function parseEnvelope(envelope: string): Record<string, string> {
  const lines = envelope.split("\n")
  const first = lines[0]
  if (!first || !first.startsWith("[agentmesh] ")) return {}
  const out: Record<string, string> = {}
  for (const segment of first.slice("[agentmesh]".length).trim().split(" | ")) {
    const index = segment.indexOf(":")
    if (index === -1) continue
    out[segment.slice(0, index).trim()] = segment.slice(index + 1).trim()
  }
  const endIndex = lines.findIndex(
    (line, i) => i > 0 && line.startsWith("(end of agentmesh message"),
  )
  out["text"] = lines.slice(1, endIndex === -1 ? undefined : endIndex).join("\n")
  return out
}
