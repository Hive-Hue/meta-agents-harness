import test from "node:test"
import assert from "node:assert/strict"
import { determineAction } from "../scripts/sync/sync-utils.mjs"

test("determineAction covers create, update, no_change and drift mapping", () => {
  assert.equal(determineAction("missing"), "create")
  assert.equal(determineAction("out_of_sync"), "update")
  assert.equal(determineAction("ok"), "no_change")
  assert.equal(determineAction("synced"), "applied")
  assert.equal(determineAction("unexpected"), "unknown")
})
