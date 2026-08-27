/**
 * Filesystem primitives shared by the registry and the inbox.
 *
 * Every write is atomic (temp file in the same directory + `rename`), so a
 * reader never observes a half-written record. Missing files are a normal
 * state here — peers come and go — so reads answer `undefined` rather than
 * throwing.
 */

import { randomBytes } from "node:crypto"
import fs from "node:fs/promises"
import path from "node:path"

function isMissing(error: unknown): boolean {
  return (error as NodeJS.ErrnoException)?.code === "ENOENT"
}

export async function ensureDir(dir: string): Promise<void> {
  await fs.mkdir(dir, { recursive: true, mode: 0o700 })
}

export async function writeJsonAtomic(file: string, value: unknown): Promise<void> {
  await ensureDir(path.dirname(file))
  const temp = `${file}.${process.pid}.${randomBytes(4).toString("hex")}.tmp`
  try {
    await fs.writeFile(temp, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 })
    await fs.rename(temp, file)
  } catch (error) {
    await fs.rm(temp, { force: true }).catch(() => {})
    throw error
  }
}

export async function readJson<T>(file: string): Promise<T | undefined> {
  try {
    return JSON.parse(await fs.readFile(file, "utf8")) as T
  } catch (error) {
    if (isMissing(error)) return undefined
    // A truncated or hand-edited file must not take the mesh down.
    return undefined
  }
}

/** Read a record together with its mtime, which is what liveness is based on. */
export async function readJsonWithMtime<T>(
  file: string,
): Promise<{ value: T; mtimeMs: number } | undefined> {
  let stat: Awaited<ReturnType<typeof fs.stat>>
  try {
    stat = await fs.stat(file)
  } catch (error) {
    if (isMissing(error)) return undefined
    throw error
  }
  const value = await readJson<T>(file)
  if (value === undefined) return undefined
  return { value, mtimeMs: stat.mtimeMs }
}

export async function listJsonFiles(dir: string): Promise<string[]> {
  try {
    const entries = await fs.readdir(dir)
    return entries.filter((name) => name.endsWith(".json")).sort()
  } catch (error) {
    if (isMissing(error)) return []
    throw error
  }
}

export async function removeFile(file: string): Promise<void> {
  await fs.rm(file, { force: true }).catch(() => {})
}

export async function removeDir(dir: string): Promise<void> {
  await fs.rm(dir, { recursive: true, force: true }).catch(() => {})
}

/** Bump mtime without rewriting the file — this is the heartbeat. */
export async function touch(file: string): Promise<boolean> {
  const now = new Date()
  try {
    await fs.utimes(file, now, now)
    return true
  } catch (error) {
    if (isMissing(error)) return false
    throw error
  }
}

/**
 * Claim a file by renaming it. Exactly one caller can win; everyone else sees
 * ENOENT. Returns the new path, or `undefined` if the file was already taken.
 */
export async function claimFile(file: string, suffix: string): Promise<string | undefined> {
  const claimed = `${file}${suffix}`
  try {
    await fs.rename(file, claimed)
    return claimed
  } catch (error) {
    if (isMissing(error)) return undefined
    throw error
  }
}

/**
 * Age of a record in ms, clamped at zero: filesystem mtimes carry sub-ms
 * precision while `Date.now()` is truncated, so a file written right now can
 * otherwise look a fraction of a millisecond into the future.
 */
export function ageMs(mtimeMs: number, now: number): number {
  return Math.max(0, now - mtimeMs)
}

/** True when a process with this pid exists and we are allowed to signal it. */
export function pidAlive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) return true // unknown: don't claim it's dead
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM"
  }
}
