import assert from "node:assert/strict"
import { describe, it } from "node:test"

import { isMessageId, newMessageId } from "../src/ids.ts"

describe("message ids", () => {
  it("has the agm_ prefix and a 26-char ULID body", () => {
    const id = newMessageId()
    assert.match(id, /^agm_[0-9A-HJKMNP-TV-Z]{26}$/)
    assert.ok(isMessageId(id))
  })

  it("rejects malformed ids", () => {
    assert.equal(isMessageId("agm_short"), false)
    assert.equal(isMessageId("nope_01ARZ3NDEKTSV4RRFFQ69G5FAV"), false)
    // I, L, O and U are not in the Crockford alphabet.
    assert.equal(isMessageId("agm_01ARZ3NDEKTSV4RRFFQ69G5FAI"), false)
  })

  it("sorts by creation order, including inside one millisecond", () => {
    const ids = Array.from({ length: 500 }, () => newMessageId())
    assert.deepEqual(ids, [...ids].sort())
    assert.equal(new Set(ids).size, ids.length)
  })

  it("stays monotonic when the clock does not move", () => {
    const first = newMessageId(1_700_000_000_000)
    const second = newMessageId(1_700_000_000_000)
    assert.ok(second > first)
  })
})
