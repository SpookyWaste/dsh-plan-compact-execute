/**
 * Regression guard for the operator check in `scripts/verify-compaction.mjs`.
 *
 * The checker is the acceptance evidence for a real click, so its own verdict
 * must be trustworthy: it has to pass the geometry our button produces and fail
 * the geometry `/compact` produces (standalone, `turn: null`) as well as the one
 * that would lose the plan (plan call inside `shadowedSeqs`).
 */
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import zlib from "node:zlib";
import { readEvents, verifyEvents } from "./scripts/verify-compaction.mjs";

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

/** Write one synthetic session log, split over two zstd frames like the real appender. */
function writeLog(events) {
  const dir = mkdtempSync(join(tmpdir(), "dsh-compact-verify-"));
  const file = join(dir, "session.v4.jsonl.zstd");
  const lines = events.map((event) => JSON.stringify(event) + "\n");
  const half = Math.ceil(lines.length / 2);
  const frame = (part) => zlib.zstdCompressSync(Buffer.from(part.join(""), "utf8"));
  writeFileSync(file, Buffer.concat([frame(lines.slice(0, half)), frame(lines.slice(half))]));
  return file;
}

const event = (seq, type, data = {}) => ({ seq, type, time: seq, data });

/** A plan review whose approval is still pending when the compaction lands. */
function goodLog() {
  return [
    event(1, "session", { id: "s" }),
    event(2, "turn/start", { turn: 3 }),
    event(3, "user/message", {}),
    event(4, "assistant/message", { message: { role: "assistant", content: [{ type: "text", text: "explore" }] } }),
    event(5, "tool/result", { turn: 3, message: { role: "tool", toolCallId: "c1", content: [] } }),
    event(6, "tool/call", { turn: 3, callId: "c2", name: "exit_plan_mode", arguments: "{}" }),
    event(7, "assistant/message", {
      message: { role: "assistant", content: [{ type: "tool-call", id: "c2", name: "exit_plan_mode", arguments: {} }] },
    }),
    event(8, "compaction/start", { compactionId: "k1", turn: 3 }),
    event(9, "compaction/summary", { compactionId: "k1", summary: [{ type: "text", text: "summary" }], shadowedRange: { start: 3, end: 5 }, shadowedSeqs: [3, 4, 5], shadowedTokenCount: 900 }),
    event(10, "compaction/end", { compactionId: "k1", turn: 3 }),
    event(11, "tool/result", {
      turn: 3,
      message: { role: "tool", toolCallId: "c2", content: [{ type: "text", text: "Plan approved — plan mode exited" }] },
    }),
  ];
}

check("the geometry our button produces passes every check", () => {
  const file = writeLog(goodLog());
  const report = verifyEvents(readEvents(file));
  assert.equal(report.checks.every((entry) => entry.ok), true, JSON.stringify(report.checks.filter((entry) => !entry.ok)));
  assert.equal(report.compaction.reviewedPlanSeq, 7);
  assert.equal(report.compaction.shadowedNodes, 3);
  assert.equal(report.checks.length, 6);
});

check("a compaction appended after the approval result fails the interleaving check", () => {
  const events = goodLog();
  // Move the whole compaction bracket behind the approval result: the shape a
  // "approve first, compact afterwards" implementation would produce.
  const compaction = events.filter((entry) => entry.type.startsWith("compaction/") || entry.data?.source?.kind === "compact-checkpoint");
  const rest = events.filter((entry) => !compaction.includes(entry));
  const moved = [...rest, ...compaction].map((entry, index) => ({ ...entry, seq: index + 1 }));
  const report = verifyEvents(moved);
  const failed = report.checks.filter((entry) => !entry.ok).map((entry) => entry.label);
  assert.deepEqual(failed, ["the compaction ran while the plan review was still pending"]);
});

check("a plan call inside the compacted span fails the plan checks", () => {
  const events = goodLog();
  const summary = events.find((entry) => entry.type === "compaction/summary");
  summary.data.shadowedSeqs = [3, 4, 5, 7];
  summary.data.shadowedRange = { start: 3, end: 7 };
  const report = verifyEvents(events);
  const failed = report.checks.filter((entry) => !entry.ok).map((entry) => entry.label);
  assert.deepEqual(failed, ["the reviewed plan stayed outside the compacted span"]);
});

check("a standalone compaction (the /compact shape) fails the in-turn check", () => {
  const events = goodLog();
  events.find((entry) => entry.type === "compaction/start").data.turn = null;
  events.find((entry) => entry.type === "compaction/end").data.turn = null;
  const report = verifyEvents(events);
  const failed = report.checks.filter((entry) => !entry.ok).map((entry) => entry.label);
  assert.deepEqual(failed, ["the newest compaction is an in-turn compaction"]);
});

check("a failed compaction attempt is reported as a failure", () => {
  const events = goodLog();
  events.find((entry) => entry.type === "compaction/end").data.error = "summary is not smaller";
  const report = verifyEvents(events);
  assert.equal(report.checks.find((entry) => entry.label === "the compaction completed without an error").ok, false);
});

check("an unfinished triple is not treated as a complete compaction", () => {
  const events = goodLog().filter((entry) => entry.type !== "compaction/end");
  assert.equal(verifyEvents(events).complete, 0);
});

check("a log without any compaction yields no checks", () => {
  assert.equal(verifyEvents([event(1, "session", {})]).checks.length, 0);
});

console.log(failures === 0 ? "\nall verifier checks passed" : `\n${failures} verifier check(s) failed`);
process.exit(failures === 0 ? 0 : 1);