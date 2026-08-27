/**
 * The inbox: how a message actually reaches another agent.
 *
 * The sender only writes a file into `<home>/inbox/<to>/`. The recipient's own
 * plugin watches that directory and injects the envelope into its own session
 * with its own authenticated client — so a message crosses opencode servers,
 * passwords and restarts without the sender needing any of that. A message
 * sent to an agent that is currently down simply waits until it comes back.
 */

import { watch, type FSWatcher } from "node:fs"
import path from "node:path"

import type { MeshConfig } from "./config.ts"
import {
  ageMs,
  claimFile,
  ensureDir,
  listJsonFiles,
  readJson,
  readJsonWithMtime,
  removeFile,
  writeJsonAtomic,
} from "./store.ts"
import type { MeshAck, MeshMessage } from "./types.ts"

const CLAIM_SUFFIX = ".taken"

export function inboxDirFor(config: MeshConfig, id: string): string {
  return path.join(config.inboxDir, id)
}

function ackPath(config: MeshConfig, messageId: string): string {
  return path.join(config.acksDir, `${messageId}.json`)
}

/** Queue a message for `message.to`. Returns once it is durably on disk. */
export async function enqueue(config: MeshConfig, message: MeshMessage): Promise<void> {
  const dir = inboxDirFor(config, message.to)
  await ensureDir(dir)
  await writeJsonAtomic(path.join(dir, `${message.id}.json`), message)
}

export async function readAck(
  config: MeshConfig,
  messageId: string,
): Promise<MeshAck | undefined> {
  return readJson<MeshAck>(ackPath(config, messageId))
}

async function writeAck(config: MeshConfig, ack: MeshAck): Promise<void> {
  await writeJsonAtomic(ackPath(config, ack.id), ack)
}

/** Poll for the recipient's ack until it lands or the window closes. */
export async function waitForAck(
  config: MeshConfig,
  messageId: string,
  timeoutMs: number,
): Promise<MeshAck | undefined> {
  const deadline = Date.now() + timeoutMs
  const step = 100
  for (;;) {
    const ack = await readAck(config, messageId)
    if (ack) return ack
    if (Date.now() >= deadline) return undefined
    await new Promise((resolve) => setTimeout(resolve, Math.min(step, deadline - Date.now())))
  }
}

/** Drop acks nobody is waiting for any more. */
export async function reapAcks(config: MeshConfig, now: number = Date.now()): Promise<number> {
  let removed = 0
  for (const file of await listJsonFiles(config.acksDir)) {
    const full = path.join(config.acksDir, file)
    const read = await readJsonWithMtime<MeshAck>(full)
    if (read && ageMs(read.mtimeMs, now) < config.expireAfterMs) continue
    await removeFile(full)
    removed++
  }
  return removed
}

export type InboxHandler = (message: MeshMessage) => Promise<void>

/**
 * Watches one agent's inbox. `fs.watch` handles the common case; the interval
 * is the safety net for the events macOS drops and for files that landed while
 * the process was down.
 */
export class InboxWatcher {
  private watcher?: FSWatcher
  private timer?: NodeJS.Timeout
  private draining = false
  private pending = false
  private stopped = false

  private readonly config: MeshConfig
  private readonly id: string
  private readonly sessionID: string
  private readonly handler: InboxHandler
  private readonly onError: (error: unknown, context: string) => void

  constructor(
    config: MeshConfig,
    id: string,
    sessionID: string,
    handler: InboxHandler,
    onError: (error: unknown, context: string) => void,
  ) {
    this.config = config
    this.id = id
    this.sessionID = sessionID
    this.handler = handler
    this.onError = onError
  }

  get dir(): string {
    return inboxDirFor(this.config, this.id)
  }

  async start(): Promise<void> {
    await ensureDir(this.dir)
    await this.recoverClaimed()
    try {
      this.watcher = watch(this.dir, { persistent: false }, () => void this.drain())
      this.watcher.on("error", (error) => this.onError(error, "inbox watch"))
    } catch (error) {
      // Not fatal: the poll interval still delivers, just less promptly.
      this.onError(error, "inbox watch setup")
    }
    this.timer = setInterval(() => void this.drain(), this.config.pollIntervalMs)
    this.timer.unref?.()
    await this.drain()
  }

  async stop(): Promise<void> {
    this.stopped = true
    this.watcher?.close()
    this.watcher = undefined
    if (this.timer) clearInterval(this.timer)
    this.timer = undefined
  }

  /**
   * A message claimed by a previous process that died mid-injection is still
   * sitting there as `*.json.taken`. We own this inbox, so it is safe to put
   * every claim back and try again.
   */
  private async recoverClaimed(): Promise<void> {
    const fs = await import("node:fs/promises")
    let entries: string[]
    try {
      entries = await fs.readdir(this.dir)
    } catch {
      return
    }
    for (const name of entries) {
      if (!name.endsWith(CLAIM_SUFFIX)) continue
      const from = path.join(this.dir, name)
      const to = path.join(this.dir, name.slice(0, -CLAIM_SUFFIX.length))
      await fs.rename(from, to).catch(() => {})
    }
  }

  /** Process everything currently queued, oldest first (ULID file names sort). */
  async drain(): Promise<void> {
    if (this.stopped) return
    if (this.draining) {
      this.pending = true
      return
    }
    this.draining = true
    try {
      do {
        this.pending = false
        for (const file of await listJsonFiles(this.dir)) {
          if (this.stopped) return
          await this.deliverOne(path.join(this.dir, file))
        }
      } while (this.pending)
    } catch (error) {
      this.onError(error, "inbox drain")
    } finally {
      this.draining = false
    }
  }

  private async deliverOne(file: string): Promise<void> {
    const claimed = await claimFile(file, CLAIM_SUFFIX)
    if (!claimed) return // someone else got there first
    const message = await readJson<MeshMessage>(claimed)
    if (!message?.id || !message.text) {
      await removeFile(claimed)
      return
    }
    try {
      await this.handler(message)
      await writeAck(this.config, {
        id: message.id,
        to: this.id,
        sessionID: this.sessionID,
        status: "injected",
        at: new Date().toISOString(),
      })
    } catch (error) {
      this.onError(error, `inject ${message.id}`)
      await writeAck(this.config, {
        id: message.id,
        to: this.id,
        sessionID: this.sessionID,
        status: "failed",
        detail: error instanceof Error ? error.message : String(error),
        at: new Date().toISOString(),
      })
    } finally {
      await removeFile(claimed)
    }
  }
}
