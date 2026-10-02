/**
 * Behavior guard for the "the approved plan is never compacted" invariant.
 *
 * The plan under review lives in the assistant message that carries the
 * unanswered `exit_plan_mode` tool call, and its approval is that call's
 * not-yet-appended result. Both must survive the pre-plan compaction verbatim:
 * if the range rule ever folded the pending batch into the shadowed span, the
 * model would execute from a summary instead of the approved text — silently,
 * because the summary is a valid surface.
 *
 * The rule is exercised against the real `compactableRangeBeforePendingBatch`
 * and the real `toolPairingBalanced*` helpers from the installed
 * `@deepseek-ai/dsh-compaction`, so this test fails if either the plugin's rule
 * or the seam's contract drifts.
 *
 * `test-range.mjs` pins edge selection on small surfaces; this file pins the
 * property the user is promised — the plan, the approval, and the plan-mode
 * marker stay outside the span across the shapes a real session takes,
 * including one that already contains an earlier compaction checkpoint.
 */
import assert from "node:assert/strict";
import { toolPairingBalancedAfter, toolPairingBalancedBefore } from "@deepseek-ai/dsh-compaction";
import { compactableRangeBeforePendingBatch } from "../lib/range.js";
import { node, session } from "./session.mjs";

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

/** Surface half of the fixture. */
const surface = (entries) => session(entries).session;

/**
 * Assert that a compactable range leaves the pending batch — and therefore the
 * plan and its approval — untouched: the span must end strictly before the
 * first node of the unfinished batch, and its trailing cut must be balanced.
 */
const assertPlanRetained = (target, bandStart) => {
  const range = compactableRangeBeforePendingBatch(target);
  if (range === null) {
    // Nothing precedes the batch: the whole surface IS the plan, so there is
    // trivially nothing that could shadow it.
    return;
  }
  assert.ok(
    range.end < bandStart,
    `the compacted span ends at ${range.end}, which is not before the pending batch starting at ${bandStart}`,
  );
  assert.equal(
    toolPairingBalancedAfter(target, range.end),
    true,
    "the compacted span must end on a balanced cut",
  );
  assert.equal(
    toolPairingBalancedBefore(target, range.start),
    true,
    "the compacted span must start on a balanced cut",
  );
};

check("a plan review after an earlier compaction keeps the new plan outside the span", () => {
  // 1 system, an earlier compaction checkpoint, more history, then the plan
  // message carrying the unanswered exit_plan_mode call (seq 7).
  const target = surface([
    node(1, "system/message"),
    node(2, "user/message"),
    node(3, "assistant/message", 1),
    node(4, "tool/result"),
    node(5, "user/message"),
    node(6, "user/message"),
    node(7, "assistant/message", 1), // the reviewed plan + unanswered call
  ]);
  assertPlanRetained(target, 7);
  const range = compactableRangeBeforePendingBatch(target);
  assert.deepEqual({ ...range }, { start: 2, end: 6 });
});

check("the plan message is never the head of the compacted span", () => {
  // The pending batch begins at the plan, so the span must end at most one node
  // before it; a rule that included the plan would report end >= 5 here.
  const target = surface([
    node(1, "system/message"),
    node(2, "user/message"),
    node(3, "assistant/message", 1),
    node(4, "tool/result"),
    node(5, "assistant/message", 1),
  ]);
  assertPlanRetained(target, 5);
  assert.ok(compactableRangeBeforePendingBatch(target).end < 5);
});

check("a plan with no preceding history compacts nothing at all", () => {
  const target = surface([node(1, "system/message"), node(2, "assistant/message", 1)]);
  assert.equal(compactableRangeBeforePendingBatch(target), null);
});

check("an earlier compaction checkpoint may itself be shadowed, but the plan may not", () => {
  // This is the shape the GUI shows: an existing 「已压缩」 checkpoint above the
  // plan approval. Shadowing that older checkpoint is correct — re-summarizing
  // an old summary is the whole point — while the plan and its approval stay.
  const target = surface([
    node(1, "system/message"),
    node(2, "user/message"),
    node(3, "user/message"), // the earlier compact-checkpoint replacement
    node(4, "assistant/message", 1),
    node(5, "tool/result"),
    node(6, "assistant/message", 1), // the reviewed plan + unanswered call
  ]);
  const range = compactableRangeBeforePendingBatch(target);
  assert.deepEqual({ ...range }, { start: 2, end: 5 });
  assert.ok(!(range.start <= 6 && 6 <= range.end), "the plan node is inside the compacted span");
});

check("a settled sibling result in the batch does not pull the plan into the span", () => {
  // The plan review may sit beside an already-answered call from the same batch;
  // the whole batch is retained, so the span still ends before its first node.
  const target = surface([
    node(1, "system/message"),
    node(2, "user/message"),
    node(3, "user/message"),
    node(4, "assistant/message", 2), // two calls: one answered, one is the review
    node(5, "tool/result"),
  ]);
  const range = compactableRangeBeforePendingBatch(target);
  assert.deepEqual({ ...range }, { start: 2, end: 3 });
  assert.ok(range.end < 4);
});

check("every surface shape retains the batch and yields seam-accepted edges", () => {
  // Exhaustive over batch start positions on a fixed prefix: whatever the plan
  // message's index, the span must stop before the batch and satisfy the seam.
  const prefix = [
    node(1, "system/message"),
    node(2, "user/message"),
    node(3, "assistant/message", 1),
    node(4, "tool/result"),
    node(5, "user/message"),
  ];
  for (let batchStart = 2; batchStart <= prefix.length; batchStart += 1) {
    const target = surface([...prefix.slice(0, batchStart), node(100, "assistant/message", 1)]);
    assertPlanRetained(target, 100);
  }
});

console.log(
  failures === 0 ? "\nall plan-retention checks passed" : `\n${failures} plan-retention check(s) failed`,
);
process.exit(failures === 0 ? 0 : 1);