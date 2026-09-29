/**
 * Host half of `dsh-plan-compact-execute`: the remote capability behind the
 * plan-review card's "Compact and run" option.
 *
 * The Web client calls {@link PlanCompactExecGateway.compactBeforeExecute} while
 * `exit_plan_mode` is still awaiting the human decision. That call runs
 * `ctx.compaction.compactRegion()` over the history submitted before the plan
 * (see `./range.ts` for why that span and why not `compactNow`), then the client
 * answers the review with the plan's own approve label so plan mode exits with a
 * compacted context.
 *
 * Nothing here appends new session vocabulary or new model-visible input: the
 * compaction reuses the existing `compaction/start|summary|end` events and the
 * `compact-checkpoint` replacement message, and the approval is the ordinary
 * `exit_plan_mode` answer.
 *
 * @module dsh-plan-compact-execute
 */
import { TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import type { Context } from '@deepseek-ai/cordis'
import Schema from '@deepseek-ai/schemastery'
import type { TypertRegistry } from '@deepseek-ai/dsh-typert-registry'
import type { CompactionEngine, CompactionResult } from '@deepseek-ai/dsh-compaction'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { Session } from '@deepseek-ai/dsh-session'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { TokenMeasurement } from '@deepseek-ai/dsh-token-meter'
import type {} from '@deepseek-ai/dsh-token-meter'
import type {} from '@deepseek-ai/dsh-agent'
import type {} from '@deepseek-ai/dsh-agent-preset-registry'
import { compactableRangeBeforePendingBatch, type CompactRange } from './range.js'
import { METHOD_NAME, PACKAGE_NAME, SERVICE_KEY, type CompactBeforeExecuteResult } from './protocol.js'
import { TYPERT } from './typert.js'

/** Cordis plugin name; also the loader entry id this package's patch inserts. */
export const name = 'plan-compact-execute'

/**
 * Services required before the remote capability can serve a request.
 *
 * `compaction` is deliberately NOT injected: the Web app mounts
 * `dsh-compaction-basic` inside each agent preset's isolated `compaction` realm
 * and disables the host-plane row, so a root entry waiting for `ctx.compaction`
 * stays pending forever and never registers its manifest. The engine is resolved
 * per request instead — see {@link resolveCompaction}.
 */
export const inject = ['typert', 'agents', 'tokenMeter']

/** Deployment-owned tuning of the pre-plan compaction decision. */
export interface Config {
  /**
   * Route-priced tokens the compactable span must hold before a compaction is
   * attempted. Below it the request reports `nothing-to-compact`, because a
   * summary framed for such a span cannot shrink it and would only append a
   * failed compaction attempt to the session log.
   */
  minShadowedTokens: number
}

/** Validate the deployment-owned threshold. Unknown or non-positive input fails at load. */
export const Config: Schema<Config> = Schema.object({
  minShadowedTokens: Schema.natural().default(2000),
})

/**
 * Resolve the compaction engine that owns one reviewed session.
 *
 * A preset realm stores its services under a realm-private symbol, so the Web
 * app's `compaction` is reachable neither by injecting it at the root nor by
 * reading the agent's own scope: the preset registry is the documented accessor
 * for a caller that already holds the agent ("Browser RPCs hold the Agent but
 * resolve outside that realm"). Deployments without preset realms may instead
 * compose compaction into the agent scope or keep it on the host plane, so both
 * fallbacks stay in the chain; `undefined` means the session genuinely has no
 * compaction capability.
 *
 * @param ctx - plugin context carrying the injected services.
 * @param agent - the live agent whose session is under review.
 * @returns the engine that owns that session, or undefined when none is mounted.
 */
function resolveCompaction(ctx: Context, agent: Agent): CompactionEngine | undefined {
  return ctx.get('agentPresets')?.serviceFor(agent, 'compaction') ?? agent.ctx.get('compaction') ?? ctx.get('compaction')
}

/**
 * Attach the session brand to a codec-validated wire value.
 *
 * The descriptor already rejected empty or non-string input at the wire
 * boundary, and `dsh-session` (the brand's owner) is a build-time type
 * dependency only, so the brand is applied here instead of importing its
 * runtime constructor.
 *
 * @param wire - validated non-empty session identity.
 * @returns the same value as a {@link SessionId}.
 */
function sessionIdOf(wire: string): SessionId {
  return wire as SessionId
}

/**
 * Price one surface span with the token meter that compaction itself uses.
 *
 * Mirrors the invariant `dsh-compaction-basic` enforces before summarizing: the
 * meter's positional nodes must be the current surface nodes, so a stale meter
 * fails loudly here instead of mispricing the decision.
 *
 * @param session - session owning the measured surface.
 * @param measurement - latest meter reading for that session.
 * @param range - inclusive surface span to price.
 * @returns the summed route-priced tokens of the span.
 * @throws when the span is absent from the surface or the meter disagrees with it.
 */
function measuredTokensIn(
  session: Session,
  measurement: TokenMeasurement,
  range: CompactRange,
): number {
  const surface = session.surface.nodes
  const startIdx = surface.indexOf(range.start)
  const endIdx = surface.indexOf(range.end)
  if (startIdx < 0 || endIdx < startIdx) throw new Error(`${PACKAGE_NAME}: the compactable span is not on the current surface`)
  const priced = measurement.nodes.slice(startIdx, endIdx + 1)
  if (priced.length !== endIdx - startIdx + 1 || priced.some((node, offset) => node.seq !== surface[startIdx + offset])) {
    throw new Error(`${PACKAGE_NAME}: the token meter does not describe the current surface`)
  }
  return priced.reduce((total, node) => total + node.tokens, 0)
}

/**
 * `ctx.planCompactExec`: compact the history submitted before a pending plan
 * review so the approved plan is executed against a smaller context.
 */
export class PlanCompactExecGateway extends TypertRemoteService {
  private readonly minShadowedTokens: number

  /**
   * Register the Remote service under the manifest's service key.
   * @param ctx - owning context carrying the manifest's required services.
   * @param config - validated deployment configuration.
   */
  constructor(ctx: Context, config: Config) {
    super(ctx, SERVICE_KEY)
    this.minShadowedTokens = config.minShadowedTokens
  }

  /**
   * Replace the pre-plan history with one summary, leaving the reviewed plan and
   * the pending approval on the surface.
   *
   * Called while `exit_plan_mode` awaits the human decision: the turn is open, no
   * other append can race the summarization, and the selected span never crosses
   * the unanswered tool call. Expected failures (an active compaction lock, a
   * changed surface, a summary that cannot shrink the span, a commit or
   * persistence failure) reject with their own diagnostic; the client keeps the
   * review pending and shows the message.
   *
   * The compaction engine is resolved through {@link resolveCompaction}, because
   * the Web app isolates `compaction` inside the agent preset realm that owns it.
   *
   * @param sessionId - session whose pending review should be compacted.
   * @returns whether a compaction ran, with the shadowed span's size.
   */
  async [METHOD_NAME](sessionId: string): Promise<CompactBeforeExecuteResult> {
    const agent = this.ctx.agents.get(sessionIdOf(sessionId))
    if (agent === undefined) throw new Error(`${PACKAGE_NAME}: session "${sessionId}" has no live agent; the plan review is no longer answerable`)

    const compaction = resolveCompaction(this.ctx, agent)
    if (compaction === undefined) {
      throw new Error(`${PACKAGE_NAME}: session "${sessionId}" has no compaction capability in its agent scope; this deployment mounts no compaction backend for that agent preset`)
    }

    const session = agent.session
    const range = compactableRangeBeforePendingBatch(session)
    if (range === null) {
      this.ctx.logger(`${PACKAGE_NAME}`).info('no history precedes the pending plan review; nothing to compact')
      return { outcome: 'nothing-to-compact', shadowedNodes: 0, shadowedTokens: 0 }
    }

    const measurement = this.ctx.tokenMeter.measure(session)
    const shadowedTokens = measuredTokensIn(session, measurement, range)
    const shadowedNodes = session.surface.nodes.indexOf(range.end) - session.surface.nodes.indexOf(range.start) + 1
    if (shadowedTokens < this.minShadowedTokens) {
      this.ctx.logger(`${PACKAGE_NAME}`).info(
        'pre-plan history holds %d tokens, below minShadowedTokens (%d); nothing to compact',
        shadowedTokens,
        this.minShadowedTokens,
      )
      return { outcome: 'nothing-to-compact', shadowedNodes, shadowedTokens }
    }

    const result: CompactionResult = await compaction.compactRegion(range.start, range.end, agent, this.ctx.invocation?.signal)
    return { outcome: 'compacted', shadowedNodes: result.shadowedSeqs.length, shadowedTokens: result.shadowedTokenCount }
  }
}

/**
 * Mount the Remote capability and register this package's Typert manifest.
 *
 * `ctx.typert` is typed as the protocol's contract face, which deliberately
 * omits `register`; the live service is the registry class that owns it.
 *
 * @param ctx - plugin context carrying the injected services.
 * @param config - validated deployment configuration.
 */
export function apply(ctx: Context, config: Config): void {
  new PlanCompactExecGateway(ctx, config)
  ctx.effect(() => (ctx.typert as TypertRegistry).register(TYPERT), `${PACKAGE_NAME}: typert manifest`)
  ctx.logger(`${PACKAGE_NAME}`).info('host half mounted; compaction is resolved per agent scope')
}