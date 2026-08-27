/**
 * Message ids: `agm_` + a 26-char Crockford base32 ULID.
 *
 * Monotonic within a process: ids generated in the same millisecond increment
 * the 80-bit random tail. Because ULIDs sort lexicographically by creation
 * time, inbox files sort into arrival order by file name alone.
 */

import { randomBytes } from "node:crypto"

const PREFIX = "agm_"
const CROCKFORD = "0123456789ABCDEFGHJKMNPQRSTVWXYZ"
const ID_LENGTH = 26
const TAIL_BITS = 80n
const TAIL_MASK = (1n << TAIL_BITS) - 1n

let lastMs = -1n
let tail = 0n

function randomTail(): bigint {
  let value = 0n
  for (const byte of randomBytes(10)) value = (value << 8n) | BigInt(byte)
  return value
}

function encode(value: bigint, length: number): string {
  let out = ""
  let remaining = value
  for (let i = 0; i < length; i++) {
    out = CROCKFORD[Number(remaining & 31n)] + out
    remaining >>= 5n
  }
  return out
}

export function newMessageId(now: number = Date.now()): string {
  const ms = BigInt(now)
  if (ms <= lastMs) {
    tail = (tail + 1n) & TAIL_MASK
  } else {
    lastMs = ms
    tail = randomTail()
  }
  return PREFIX + encode((ms << TAIL_BITS) | tail, ID_LENGTH)
}

export function isMessageId(value: string): boolean {
  if (!value.startsWith(PREFIX) || value.length !== PREFIX.length + ID_LENGTH) return false
  return [...value.slice(PREFIX.length)].every((char) => CROCKFORD.includes(char))
}
