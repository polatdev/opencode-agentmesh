/**
 * The three tools the model sees.
 *
 * Session identity is never asked of the model: `sessionID`, `directory` and
 * `worktree` come from the tool context, and `serverUrl` from the plugin
 * input. That is the whole reason this is a plugin and not an MCP server.
 */

import { tool, type ToolDefinition } from "@opencode-ai/plugin"

import { TOOL_PEERS, TOOL_REGISTER, TOOL_SEND } from "./config.ts"
import type { Mesh, SessionContext } from "./mesh.ts"

const REGISTER_DESCRIPTION = `Publish this agent on the mesh so other opencode agents can discover and message it.
Call it once near the start of a session, and again whenever your role or scope changes.
id: a stable short slug other agents will address you by — usually the project name.
description: one line covering what you do and which repo/area you own; peers read this to decide what to send you.
metadata: free-form string map shown to peers, the only context they have about you before any message. Put durable facts here: project path, stack, role, current focus.
Returns your own entry plus everyone else currently on the mesh.`

const PEERS_DESCRIPTION = `List the agents on the mesh with live state: id, description, metadata, status (alive/stale), lastSeen, directory.
Use it to (1) get a valid "to" before ${TOOL_SEND}, (2) check whether a peer is still alive before or after sending, and (3) read peer metadata — project path, stack, role — to decide who a piece of work belongs to.
A stale peer is not gone: messages queue and are delivered when it returns.`

const SEND_DESCRIPTION = `Send one message to another registered agent. It is injected into that agent's opencode session as a new user turn.
This returns a delivery status, NOT the peer's answer: "delivered" (it landed in their session), "queued" (waiting for them to come back), "failed" (it could not be injected).
The peer sees NO context from your session — write self-contained: what you need, why, and every referenced fact (absolute paths, agreed contract). To get an answer, ask for one explicitly; it arrives later as a new turn, so keep working instead of waiting.
Use context as a short topic tag (e.g. "T-001 contract"). If no reply comes within a few minutes, check ${TOOL_PEERS} before re-sending.`

export function buildTools(
  mesh: Mesh,
  serverUrl: string,
): Record<string, ToolDefinition> {
  const contextOf = (ctx: {
    sessionID: string
    directory: string
    worktree: string
  }): SessionContext => ({
    sessionID: ctx.sessionID,
    directory: ctx.directory,
    worktree: ctx.worktree || ctx.directory,
    serverUrl,
  })

  return {
    [TOOL_REGISTER]: tool({
      description: REGISTER_DESCRIPTION,
      args: {
        id: tool.schema
          .string()
          .describe("Stable lowercase slug peers address you by, e.g. 'api-gateway'."),
        description: tool.schema
          .string()
          .describe("One line: what you do and which repo/area you own."),
        metadata: tool.schema
          .record(tool.schema.string(), tool.schema.string())
          .optional()
          .describe("Durable facts peers should know: project path, stack, role, focus."),
        force: tool.schema
          .boolean()
          .optional()
          .describe("Take the id over even if another live agent holds it."),
      },
      async execute(args, ctx) {
        const result = await mesh.register({
          context: contextOf(ctx),
          id: args.id,
          description: args.description,
          metadata: args.metadata ?? {},
          force: args.force ?? false,
        })
        return {
          title: `registered as ${result.self.id}`,
          output: JSON.stringify({ self: result.self, peers: result.peers }, null, 2),
          metadata: { id: result.self.id, peers: result.peers.length },
        }
      },
    }),

    [TOOL_PEERS]: tool({
      description: PEERS_DESCRIPTION,
      args: {
        include_stale: tool.schema
          .boolean()
          .optional()
          .describe("Include agents that stopped heartbeating. Default true."),
      },
      async execute(args, ctx) {
        const peers = await mesh.peers({
          sessionID: ctx.sessionID,
          includeStale: args.include_stale ?? true,
        })
        const alive = peers.filter((peer) => peer.status === "alive").length
        return {
          title: `${peers.length} agent${peers.length === 1 ? "" : "s"} (${alive} alive)`,
          output: JSON.stringify({ agents: peers }, null, 2),
          metadata: { count: peers.length, alive },
        }
      },
    }),

    [TOOL_SEND]: tool({
      description: SEND_DESCRIPTION,
      args: {
        to: tool.schema.string().describe(`Agent id from ${TOOL_PEERS}.`),
        text: tool.schema
          .string()
          .describe("Self-contained message. Include every fact the peer needs."),
        context: tool.schema
          .string()
          .optional()
          .describe("Short topic tag shown in the envelope header, e.g. 'T-001 contract'."),
      },
      async execute(args, ctx) {
        const result = await mesh.send({
          context: contextOf(ctx),
          to: args.to,
          text: args.text,
          ...(args.context ? { context_tag: args.context } : {}),
        })
        return {
          title: `${result.status} -> ${result.to}`,
          output: JSON.stringify(result, null, 2),
          metadata: { status: result.status, to: result.to, messageId: result.messageId },
        }
      },
    }),
  }
}
