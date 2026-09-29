/**
 * Range selection for "compact the context, then execute the plan".
 *
 * A plan review happens INSIDE the `exit_plan_mode` tool call, so the reviewing
 * agent is mid-turn: `ctx.compaction.compactNow()` (the `/compact` path) cannot
 * run because it claims the true idle phase through `agent.runMaintenance()`.
 * The documented in-turn entry is `ctx.compaction.compactRegion(start, end, …)`,
 * the same call automatic step-pressure compaction makes, and it requires both
 * edges to be tool-pairing balanced.
 *
 * The plan itself must survive the compaction: the reviewed plan lives in the
 * assistant message that carries the still-unanswered `exit_plan_mode` tool
 * call, and the approval is its (not yet appended) result. So the compacted span
 * is everything BEFORE the oldest node of the unfinished tool batch, and the
 * retained tail starts exactly at that batch. `/compact` semantics (retain only
 * the last surface node) would shadow the plan call and leave the model
 * executing from a summary instead of the approved text.
 *
 * @module dsh-plan-compact-execute/range
 */
import { toolPairingBalancedAfter, toolPairingBalancedBefore } from '@deepseek-ai/dsh-compaction';
/** Diagnostic for a caller that asked to compact a session without an in-flight tool batch. */
export const NOT_A_PENDING_BATCH = 'the session tail is not an unfinished tool batch';
/**
 * Select every surface node that precedes the session's unfinished tool batch.
 *
 * `start` never names a leading `system/message` surface node, because the
 * summarizer replays the compacted prefix and would otherwise fold the system
 * prompt into the summary. Both returned edges are balanced by construction: the
 * retained tail begins at the first node whose leading cut is balanced, and the
 * compacted span therefore ends at that node's predecessor.
 *
 * @param session - session whose current surface is inspected; the surface must
 *   end inside an unfinished tool batch, which is what a pending plan review is.
 * @returns the compactable span, or `null` when nothing precedes the pending
 *   batch (the session has no older history worth compacting).
 * @throws when the surface is empty or its tail is not an unfinished tool batch,
 *   because the retained-tail rule is only defined for a pending batch.
 */
export function compactableRangeBeforePendingBatch(session) {
    const nodes = session.surface.nodes;
    if (nodes.length === 0)
        return null;
    if (toolPairingBalancedAfter(session, nodes[nodes.length - 1]))
        throw new Error(NOT_A_PENDING_BATCH);
    const head = session.eventAt(nodes[0]);
    const firstIdx = head !== undefined && head.type === 'system/message' ? 1 : 0;
    let retainedIdx = nodes.length - 1;
    while (retainedIdx > firstIdx && !toolPairingBalancedBefore(session, nodes[retainedIdx]))
        retainedIdx -= 1;
    /* The pending batch is the whole surface: no older node to compact. */
    if (retainedIdx <= firstIdx)
        return null;
    return { start: nodes[firstIdx], end: nodes[retainedIdx - 1] };
}
