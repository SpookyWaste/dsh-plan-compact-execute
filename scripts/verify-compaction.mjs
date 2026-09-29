/**
 * Operator check for one "Compact and run" click.
 *
 * Reads a durable session log (`session.v4.jsonl.zstd`, a concatenation of zstd
 * frames, one per append) and verifies the geometry an in-turn pre-plan
 * compaction must show:
 *
 *   - the newest complete `compaction/start` + `compaction/summary` +
 *     `compaction/end` triple carries a numeric `turn` and no `error`, which is
 *     what distinguishes it from `/compact` (standalone, `turn: null`);
 *   - the newest plan submission (`exit_plan_mode` tool call) before that
 *     compaction is NOT among `shadowedSeqs`, so the approved plan stayed
 *     verbatim on the surface instead of being folded into the summary. That
 *     membership test is the only sound one: `shadowedSeqs` is a surface-POSITION
 *     span, so comparing its seqs numerically means nothing;
 *   - the compaction was appended while that plan review was still pending, i.e.
 *     between its tool call and the approval result. That interleaving IS the
 *     product requirement: compact first, then answer the review.
 *
 * Usage:
 *   node scripts/verify-compaction.mjs                      # newest session log
 *   node scripts/verify-compaction.mjs <session-id>          # by session id
 *   node scripts/verify-compaction.mjs --file <path>         # by log path
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import zlib from "node:zlib";

const ZSTD_MAGIC = Buffer.from([0x28, 0xb5, 0x2f, 0xfd]);

/**
 * Decode every zstd frame of one append-only session log.
 * @param file - absolute path of a `session.v4.jsonl.zstd` file.
 * @returns the concatenated decompressed text.
 */
export function decodeLog(file) {
  const buffer = readFileSync(file);
  const offsets = [];
  for (let i = 0; i + 4 <= buffer.length; i += 1) if (buffer.compare(ZSTD_MAGIC, 0, 4, i, i + 4) === 0) offsets.push(i);
  if (offsets.length === 0) return "";
  let text = "";
  for (let i = 0; i < offsets.length; i += 1) {
    try {
      text += zlib.zstdDecompressSync(buffer.subarray(offsets[i], offsets[i + 1] ?? buffer.length)).toString("utf8");
    } catch {
      // A partially written trailing frame is normal for a live session; keep what decoded.
    }
  }
  return text;
}

/**
 * Locate one session log by id, or the most recently modified log overall.
 * @param selector - session id, or undefined for the newest log.
 * @returns the log path, or undefined when nothing matched.
 */
export function findLog(selector) {
  const root = join(process.env.DSH_HOME ?? join(homedir(), ".dsh"), "sessions");
  let newest;
  for (const bucket of readdirSync(root)) {
    let sessions;
    try {
      sessions = readdirSync(join(root, bucket));
    } catch {
      continue;
    }
    for (const id of sessions) {
      if (selector !== undefined && id !== selector && id !== `session-${selector}`) continue;
      const file = join(root, bucket, id, "session.v4.jsonl.zstd");
      try {
        const { mtimeMs } = statSync(file);
        if (newest === undefined || mtimeMs > newest.mtimeMs) newest = { file, mtimeMs };
      } catch {
        // Not a session directory shape; keep looking.
      }
    }
  }
  return newest?.file;
}

/** Collect every `exit_plan_mode` call event in log order. */
export function planCalls(events) {
  return events.filter((event) => event.type === "tool/call" && event.data?.name === "exit_plan_mode");
}

/** Collect the seqs of surface nodes carrying an `exit_plan_mode` call. */
export function planCallSeqs(events) {
  const seqs = [];
  for (const event of events) {
    if (event.type === "tool/call" && event.data?.name === "exit_plan_mode") seqs.push(event.seq);
    if (event.type !== "assistant/message") continue;
    const content = event.data?.message?.content;
    if (!Array.isArray(content)) continue;
    if (content.some((block) => block?.type === "tool-call" && block?.name === "exit_plan_mode")) seqs.push(event.seq);
  }
  return seqs;
}

/**
 * Verify the newest complete compaction triple of one decoded log.
 * @param events - session events in log order.
 * @returns the assertions with their outcomes and the compaction's sizes.
 */
export function verifyEvents(events) {
  const starts = events.filter((event) => event.type === "compaction/start");
  const summaries = new Map(events.filter((event) => event.type === "compaction/summary").map((event) => [event.data.compactionId, event]));
  const ends = new Map(events.filter((event) => event.type === "compaction/end").map((event) => [event.data.compactionId, event]));
  const complete = starts
    .filter((start) => summaries.has(start.data.compactionId) && ends.has(start.data.compactionId))
    .sort((left, right) => left.seq - right.seq);
  if (complete.length === 0) return { checks: [], complete: 0 };

  const start = complete[complete.length - 1];
  const summary = summaries.get(start.data.compactionId);
  const end = ends.get(start.data.compactionId);
  const shadowed = new Set(summary.data.shadowedSeqs);
  const plans = planCallSeqs(events).filter((seq) => seq < start.seq);
  const reviewed = plans.length === 0 ? undefined : Math.max(...plans);
  // The call whose approval result follows the compaction: the interleaving proof.
  const pending = planCalls(events).filter((call) => call.seq < start.seq);
  const pendingCall = pending.at(-1);
  const approval = pendingCall === undefined
    ? undefined
    : events.find((event) => event.type === "tool/result" && event.data?.message?.toolCallId === pendingCall.data.callId);
  const withinPendingReview = approval !== undefined && start.seq < approval.seq;
  const withinPendingReviewDetail = `call seq=${String(pendingCall?.seq)} compaction seq=${String(start.seq)} result seq=${String(approval?.seq)}`;

  return {
    complete: complete.length,
    compaction: {
      compactionId: start.data.compactionId,
      turn: start.data.turn,
      error: end.data.error,
      shadowedNodes: summary.data.shadowedSeqs.length,
      shadowedTokens: summary.data.shadowedTokenCount,
      shadowedRange: summary.data.shadowedRange,
      reviewedPlanSeq: reviewed,
    },
    checks: [
      { label: "the newest compaction is an in-turn compaction", ok: typeof start.data.turn === "number", detail: `turn=${String(start.data.turn)}` },
      { label: "the compaction completed without an error", ok: end.data.error === undefined, detail: end.data.error ?? "no error" },
      { label: "the compaction wrote a summary", ok: Array.isArray(summary.data.summary) && summary.data.summary.length > 0 },
      { label: "a plan submission precedes it", ok: reviewed !== undefined, detail: `plan call seq=${String(reviewed)}` },
      { label: "the reviewed plan stayed outside the compacted span", ok: reviewed !== undefined && !shadowed.has(reviewed), detail: `${shadowed.size} shadowed nodes` },
      { label: "the compaction ran while the plan review was still pending", ok: withinPendingReview, detail: withinPendingReviewDetail },
    ],
  };
}

/** Parse one log into events, skipping any truncated trailing line. */
export function readEvents(logPath) {
  return decodeLog(logPath)
    .split("\n")
    .filter((line) => line !== "")
    .flatMap((line) => {
      try {
        return [JSON.parse(line)];
      } catch {
        return [];
      }
    });
}

/** Run the operator check for one session log and print its report. */
function main() {
  const argv = process.argv.slice(2);
  const fileFlag = argv.indexOf("--file");
  const explicitFile = fileFlag === -1 ? undefined : argv[fileFlag + 1];
  const selector = explicitFile === undefined ? argv.find((arg) => !arg.startsWith("--")) : undefined;
  const logPath = explicitFile ?? findLog(selector);
  if (logPath === undefined) {
    console.error(`no session log found${selector === undefined ? "" : ` for "${selector}"`}`);
    process.exit(1);
  }

  const events = readEvents(logPath);
  console.log(`log: ${logPath}`);
  console.log(`events: ${events.length}`);

  const report = verifyEvents(events);
  if (report.complete === 0) {
    console.error("FAIL  no complete compaction triple in this log");
    process.exit(1);
  }
  let failures = 0;
  for (const check of report.checks) {
    console.log(`${check.ok ? "PASS" : "FAIL"}  ${check.label}${check.detail === undefined ? "" : ` (${check.detail})`}`);
    if (!check.ok) failures += 1;
  }
  const { shadowedNodes, shadowedTokens, shadowedRange } = report.compaction;
  console.log(`compacted: ${shadowedNodes} nodes (~${shadowedTokens} tokens), surface span ${shadowedRange.start}..${shadowedRange.end}`);
  process.exit(failures === 0 ? 0 : 1);
}

if (process.argv[1] !== undefined && fileURLToPath(import.meta.url) === process.argv[1]) main();