/**
 * Behavior guard for the compactable-range rule.
 *
 * The rule decides which history a plan approval compacts: everything before the
 * session's unfinished tool batch, with a leading `system/message` and the
 * pending batch itself always retained. A regression here either loses the
 * reviewed plan (it would be shadowed by the summary) or asks the compaction seam
 * for an unbalanced span, which it rejects at runtime.
 */
import assert from "node:assert/strict";
import { toolPairingBalancedAfter, toolPairingBalancedBefore } from "@deepseek-ai/dsh-compaction";
import { compactableRangeBeforePendingBatch, NOT_A_PENDING_BATCH } from "../lib/range.js";
import { node, session } from "./session.mjs";

/** Only the session half of the fixture is needed here. */
const surface = (entries) => session(entries).session;

let failures = 0;
const check = (label, fn) => {
  try {
    fn();
    console.log("PASS  " + label);
  } catch (error) {
    failures += 1;
    console.log("FAIL  " + label + "\n      " + (error && error.message ? error.message : error));
  }
};

check("a system head is never inside the compacted span", () => {
  const range = compactableRangeBeforePendingBatch(
    surface([
      node(1, "system/message"),
      node(2, "user/message"),
      node(3, "assistant/message", 1),
      node(4, "tool/result"),
      node(5, "user/message"),
      node(6, "assistant/message", 1),
    ]),
  );
  assert.deepEqual({ ...range }, { start: 2, end: 5 });
});

check("without a system head the span starts at the first surface node", () => {
  const range = compactableRangeBeforePendingBatch(
    surface([node(1, "user/message"), node(2, "assistant/message", 1)]),
  );
  assert.deepEqual({ ...range }, { start: 1, end: 1 });
});

check("a pending batch with an already settled sibling result is retained whole", () => {
  const range = compactableRangeBeforePendingBatch(
    surface([
      node(1, "system/message"),
      node(2, "user/message"),
      node(3, "assistant/message", 1),
      node(4, "tool/result"),
      node(5, "assistant/message", 2),
      node(6, "tool/result"),
    ]),
  );
  assert.deepEqual({ ...range }, { start: 2, end: 4 });
});

check("the pending batch alone yields nothing to compact", () => {
  const range = compactableRangeBeforePendingBatch(
    surface([node(1, "system/message"), node(2, "assistant/message", 1)]),
  );
  assert.equal(range, null);
});

check("an empty surface yields nothing to compact", () => {
  assert.equal(compactableRangeBeforePendingBatch(surface([])), null);
});

check("a balanced tail (no unfinished batch) is rejected", () => {
  assert.throws(
    () =>
      compactableRangeBeforePendingBatch(
        surface([
          node(1, "system/message"),
          node(2, "user/message"),
          node(3, "assistant/message", 1),
          node(4, "tool/result"),
        ]),
      ),
    (error) => error instanceof Error && error.message === NOT_A_PENDING_BATCH,
  );
});

check("the returned edges are the ones the compaction seam accepts", () => {
  // The seam validates both edges with these same helpers; re-checking them here
  // proves the rule never asks for a span that would split a tool-call pair.
  const target = surface([
    node(1, "system/message"),
    node(2, "user/message"),
    node(3, "assistant/message", 1),
    node(4, "tool/result"),
    node(5, "user/message"),
    node(6, "assistant/message", 1),
  ]);
  const range = compactableRangeBeforePendingBatch(target);
  assert.equal(toolPairingBalancedBefore(target, range.start), true);
  assert.equal(toolPairingBalancedAfter(target, range.end), true);
});

console.log(failures === 0 ? "\nall range checks passed" : `\n${failures} range check(s) failed`);
process.exit(failures === 0 ? 0 : 1);