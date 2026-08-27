/**
 * Resolved configuration + on-disk layout.
 *
 * Everything the mesh needs lives under one home directory. The layout is
 * ownership-partitioned: each agent writes exactly one record file (its own)
 * and reads everyone else's, so peer discovery needs no locking at all.
 *
 *   <home>/agents/<id>.json       record, written only by <id>
 *   <home>/inbox/<id>/<msg>.json  messages for <id>, written by peers
 *   <home>/acks/<msg>.json        delivery ack, written by the recipient
 */

import os from "node:os"
import path from "node:path"

export const PACKAGE_NAME = "opencode-agentmesh"
export const TOOL_PREFIX = "agentmesh"

export const TOOL_REGISTER = `${TOOL_PREFIX}_register`
export const TOOL_PEERS = `${TOOL_PREFIX}_peers`
export const TOOL_SEND = `${TOOL_PREFIX}_send`

/** Options accepted via `"plugin": [["opencode-agentmesh", { ... }]]`. */
export type MeshOptions = {
  /** Fixed agent id for this project. Default: derived from the worktree name. */
  id?: string
  /** Mesh home directory. Default: `$XDG_DATA_HOME/opencode-agentmesh`. */
  home?: string
  /** Register automatically on the first user message. Default: true. */
  autoRegister?: boolean
  /** Append the mesh protocol to the system prompt. Default: true. */
  injectSystemPrompt?: boolean
  heartbeatIntervalMs?: number
  staleAfterMs?: number
  expireAfterMs?: number
  /** How long `agentmesh_send` waits for the peer to confirm injection. */
  ackWaitMs?: number
  /** Inbox poll interval; a fallback for missed fs.watch events. */
  pollIntervalMs?: number
  /** Maximum message body length, in characters. */
  maxTextLength?: number
}

export type MeshConfig = {
  home: string
  agentsDir: string
  inboxDir: string
  acksDir: string
  id?: string
  autoRegister: boolean
  injectSystemPrompt: boolean
  heartbeatIntervalMs: number
  staleAfterMs: number
  expireAfterMs: number
  ackWaitMs: number
  pollIntervalMs: number
  maxTextLength: number
}

const DEFAULTS = {
  autoRegister: true,
  injectSystemPrompt: true,
  heartbeatIntervalMs: 15_000,
  staleAfterMs: 60_000,
  expireAfterMs: 300_000,
  ackWaitMs: 3_000,
  pollIntervalMs: 2_000,
  maxTextLength: 8_000,
} as const

function defaultHome(): string {
  const xdg = process.env["XDG_DATA_HOME"]
  const base = xdg && xdg.trim() ? xdg : path.join(os.homedir(), ".local", "share")
  return path.join(base, PACKAGE_NAME)
}

function envString(name: string): string | undefined {
  const raw = process.env[name]
  return raw && raw.trim() ? raw.trim() : undefined
}

function envBool(name: string): boolean | undefined {
  const raw = envString(name)?.toLowerCase()
  if (raw === undefined) return undefined
  return raw === "1" || raw === "true" || raw === "yes" || raw === "on"
}

function envNumber(name: string): number | undefined {
  const raw = envString(name)
  if (raw === undefined) return undefined
  const value = Number(raw)
  return Number.isFinite(value) && value >= 0 ? value : undefined
}

function pick<T>(...candidates: (T | undefined)[]): T | undefined {
  for (const candidate of candidates) if (candidate !== undefined) return candidate
  return undefined
}

/** Env (`AGENTMESH_*`) wins over plugin options, which win over defaults. */
export function resolveConfig(options: MeshOptions = {}): MeshConfig {
  const home = path.resolve(
    pick(envString("AGENTMESH_HOME"), options.home, defaultHome()) as string,
  )
  return {
    home,
    agentsDir: path.join(home, "agents"),
    inboxDir: path.join(home, "inbox"),
    acksDir: path.join(home, "acks"),
    id: pick(envString("AGENTMESH_ID"), options.id),
    autoRegister: pick(
      envBool("AGENTMESH_AUTO_REGISTER"),
      options.autoRegister,
      DEFAULTS.autoRegister,
    ) as boolean,
    injectSystemPrompt: pick(
      envBool("AGENTMESH_INJECT_SYSTEM_PROMPT"),
      options.injectSystemPrompt,
      DEFAULTS.injectSystemPrompt,
    ) as boolean,
    heartbeatIntervalMs: pick(
      envNumber("AGENTMESH_HEARTBEAT_INTERVAL_MS"),
      options.heartbeatIntervalMs,
      DEFAULTS.heartbeatIntervalMs,
    ) as number,
    staleAfterMs: pick(
      envNumber("AGENTMESH_STALE_AFTER_MS"),
      options.staleAfterMs,
      DEFAULTS.staleAfterMs,
    ) as number,
    expireAfterMs: pick(
      envNumber("AGENTMESH_EXPIRE_AFTER_MS"),
      options.expireAfterMs,
      DEFAULTS.expireAfterMs,
    ) as number,
    ackWaitMs: pick(
      envNumber("AGENTMESH_ACK_WAIT_MS"),
      options.ackWaitMs,
      DEFAULTS.ackWaitMs,
    ) as number,
    pollIntervalMs: pick(
      envNumber("AGENTMESH_POLL_INTERVAL_MS"),
      options.pollIntervalMs,
      DEFAULTS.pollIntervalMs,
    ) as number,
    maxTextLength: pick(
      envNumber("AGENTMESH_MAX_TEXT_LENGTH"),
      options.maxTextLength,
      DEFAULTS.maxTextLength,
    ) as number,
  }
}

/** Agent ids are lowercase slugs so they are safe as file names. */
export const ID_PATTERN = /^[a-z0-9][a-z0-9_-]{1,63}$/

export function slugify(value: string): string {
  const slug = value
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/^[^a-z0-9]+/, "")
    .replace(/-+$/, "")
    .slice(0, 64)
  return slug.length >= 2 ? slug : "agent"
}
