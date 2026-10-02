/**
 * Browser half of `dsh-plan-compact-execute`: the plan-review card's
 * "Compact and run" decision.
 *
 * The official `PlanReviewPanel` renders two decisions, but it renders the
 * strip's control slot `conversation.plan-review.actions` — a session-scoped
 * list that `dsh-client-ui-plan` already fills with its "full plan" link. This
 * plugin contributes one more entry to that list rather than taking the panel
 * over, so the official card, its preview link, its automatic preview, and its
 * own two decisions keep behaving exactly as installed, and the third decision
 * appears beside them.
 *
 * A decision has two halves. Compaction runs on the host (this package's Remote
 * method, called while `exit_plan_mode` still awaits the human). Approving can
 * only run through the live review carrier, because that carrier owns the Host
 * waterfall which settles the request: it is read from the session's published
 * pending interaction (`useSessionStatus`) — the very object the official panel
 * holds — and answered with the plan's own approve label, which is how the
 * official panel answers too.
 *
 * Locking. While the host rewrites the history the plan is about to run
 * against, the official decisions must be out of reach: a second decision would
 * settle the review mid-compaction. The official panel's buttons cannot be
 * disabled from outside (their `busy` is panel-local), so the lock uses the
 * pending-interaction registry's documented precedence instead: this plugin
 * publishes its own interaction for the session at a precedence above the
 * official domains, which is what the composer chain elects, and publishes a
 * progress card for it. The official panel is therefore unmounted for exactly
 * as long as the compaction runs, and comes back — never having been
 * unpublished — when a failed attempt releases the lock. `test-lock-protocol.mjs`
 * pins the mechanism against the installed bundles.
 *
 * Context occupancy. This card is a composer takeover, so the ring the official
 * composer renders below its input — the one reading the user would compare a
 * compaction against — is not on screen while the decision is. The decision's
 * own leading icon therefore carries that reading: the official compact mark's
 * ring drawn as the occupancy of the next request, from the same
 * `contextPressure` projection and the same resolution the official meter uses
 * (`test-official-parity.mjs` fails when that resolution drifts). The exact
 * percentage stays in the tooltip, and a session without a reported capacity or
 * usage keeps the unmodified official mark rather than claiming zero.
 *
 * Artifact contract: this file compiles to a classic script served as
 * `/plugins/<package>/client.js`. It may only `require` the shell seed modules
 * (`react`, `react/jsx-runtime`, `@deepseek-ai/dsh-client-ui-primitives`), it
 * must keep every side effect — including the stylesheet below — inside the
 * factory closure, and it must stay free of import/export statements. All type
 * imports are erased; the wire literals it shares with the host half are
 * repeated here on purpose and guarded by `test-manifest.mjs`.
 *
 * @module dsh-plan-compact-execute/client
 */
import type { Context } from '@deepseek-ai/cordis'
import type { ReactNode } from 'react'
import type { ComposedProps } from '@deepseek-ai/dsh-client-ui-slots'
import type { PlanReview } from '@deepseek-ai/dsh-client-ui-user-questions/client'
import type { SessionPendingInteraction, UiSession } from '@deepseek-ai/dsh-client-ui-session/client'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { RemoteResult } from '@deepseek-ai/dsh-typert-protocol'
import type { ContextPressureProjection } from '@deepseek-ai/dsh-token-meter/client'
import type { CompactBeforeExecuteResult } from './protocol.js'
import type {} from '@deepseek-ai/dsh-api-remotes/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-session/client'

/** Browser module id; must equal the package name for the boot graph to match. */
const BUNDLE_ID = 'dsh-plan-compact-execute'

/** Dictionary namespace owned by this plugin. */
const NS = 'planCompact'

/** Remote method name; mirrors `protocol.ts` for the browser bundle. */
const METHOD_NAME = 'compactBeforeExecute'

/** Wire namespace; mirrors `protocol.ts` for the browser bundle. */
const SERVICE_KEY = 'planCompactExec'

/** Official strip slot this plugin contributes its decision to. */
const SLOT_REVIEW_ACTIONS = 'conversation.plan-review.actions'

/** Official composer chain the compaction lock's progress card is elected from. */
const SLOT_COMPOSER = 'conversation.composer'

/**
 * Presentation kind of the compaction lock.
 *
 * Deliberately a kind of its own: the official domains publish `question` and
 * `plan-review`, the composer chain discriminates carriers with `instanceof`,
 * and the workspace status presentation only recognises the three official
 * kinds and ignores everything else, so a distinct kind displaces the official
 * card without being mistaken for one.
 */
const LOCK_KIND = 'plan-compact'

/**
 * Precedence of the compaction lock, above the official domains (plan review 2,
 * question 1). Higher precedence wins for the session, which is what removes
 * the official panel from the composer while the compaction runs.
 */
const LOCK_PRECEDENCE = 3

/**
 * Longest one host compaction may run before this control gives the review back.
 *
 * The lock suppresses every official card for its Session — that is what makes the
 * decision exclusive — so a host call that never settles would leave the user with
 * no card at all: no plan review, and no later question inside that Session either.
 * A lost connection is exactly such a case, and it leaves no error to react to.
 * The deadline is generous (a large Session summarizes in about a minute), and a
 * late result is harmless because the host refuses a second compaction while its
 * own compaction lock is held.
 */
const COMPACTION_DEADLINE_MS = 5 * 60 * 1000

/**
 * How long the lock outlives a landed answer.
 *
 * Answering settles the request, but the official card leaves the composer only
 * after the answering projection reaches the client. Releasing the lock first
 * would flash the official two-button panel back for that round trip, so the
 * progress card covers it instead.
 */
const SETTLE_GRACE_MS = 400

/**
 * Geometry of the occupancy ring, matching the official compact icon's artwork:
 * the same square view box and the same radius, drawn at the icon slot's 14px.
 *
 * The ring replaces that artwork, so it has to land in the same pixel box; the
 * stroke is the artwork's own 1 unit, widened just enough for a partial arc to
 * read at that size.
 */
const RING_VIEWBOX = 16
/** Radius of the ring inside the view box: the artwork's own circle. */
const RING_RADIUS = 6.5
/** Centre of that circle, and the pivot the arc is rotated about. */
const RING_CENTER = RING_VIEWBOX / 2
/** Length of one full turn, the unit `stroke-dasharray` measures an arc in. */
const RING_CIRCUMFERENCE = 2 * Math.PI * RING_RADIUS
/** Stroke width of the track and the arc alike. */
const RING_STROKE_WIDTH = 1.25
/** Track tone: the opacity the official artwork fades its own full circle to. */
const RING_TRACK_OPACITY = 0.35

/** Simplified Chinese dictionary (the key-set source of truth). */
const zh = {
  'compactExecute': '压缩后执行',
  'compacting': '压缩中…',
  'compactHint': '把计划提交前的历史压缩成摘要，然后立即执行计划',
  'compactHintUsage': '把计划提交前的历史压缩成摘要，然后立即执行计划（上下文已用 {percent}）',
  'compactionFailedPrefix': '压缩失败：',
  'compactionTimedOut': '压缩超时，已解除锁定，可以重试。',
  'answerFailedPrefix': '未能执行计划：',
  'noCarrier': '这条计划审阅已经结束。',
  'statusSent': '回答已发送；面板未能关闭。',
  'progressCompacting': '正在压缩上下文',
  'progressApplying': '正在执行计划',
  'progressNote': '压缩完成后会立即执行计划。',
}

/** English dictionary, checked complete against the zh key set. */
const en: Record<keyof typeof zh, string> = {
  'compactExecute': 'Compact and run',
  'compacting': 'Compacting…',
  'compactHint': 'Compact the history submitted before the plan, then run it immediately',
  'compactHintUsage': 'Compact the history submitted before the plan, then run it immediately ({percent} of context used)',
  'compactionFailedPrefix': 'Compaction failed: ',
  'compactionTimedOut': 'The compaction timed out; the lock is released and you can try again.',
  'answerFailedPrefix': 'The plan was not run: ',
  'noCarrier': 'This plan review has already ended.',
  'statusSent': 'Reply sent; the panel could not close.',
  'progressCompacting': 'Compacting the context',
  'progressApplying': 'Running the plan',
  'progressNote': 'The plan runs as soon as the compaction finishes.',
}

/** This namespace's key union. */
type PlanCompactKey = keyof typeof zh

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** The plan-review decision control's copy. */
    planCompact: PlanCompactKey
  }
}

/**
 * The compaction lock as the pending-interaction registry carries it.
 *
 * Only the base identity is required: consumers reach a pending interaction
 * through the session status, and the official presentation ignores kinds it
 * does not know.
 */
interface PlanCompactLock {
  /** Request identity of the review being compacted. */
  readonly key: string
  /** @see LOCK_KIND */
  readonly kind: typeof LOCK_KIND
  /** Session whose review is being compacted. */
  readonly sessionId: SessionId
}

declare module '@deepseek-ai/dsh-client-ui-session/client' {
  interface SessionPendingInteractionMap {
    /** The compaction lock this plugin holds while it compacts a plan review. */
    'plan-compact': PlanCompactLock
  }
}

/** How one awaited host call ended. */
type DeadlineOutcome<T> =
  | { readonly kind: 'settled'; readonly value: T }
  | { readonly kind: 'rejected'; readonly cause: unknown }
  | { readonly kind: 'expired' }

/** Why one review's compaction attempt did not run the plan. */
type CompactionFailure =
  | { readonly kind: 'compaction'; readonly message: string }
  | { readonly kind: 'answer'; readonly message: string }
  | { readonly kind: 'timeout' }
  | { readonly kind: 'carrier-gone' }
  | { readonly kind: 'status-sent' }

/** State of one review's compaction, keyed by the review's request key. */
type CompactionTask =
  | { readonly key: string; readonly sessionId: string; readonly phase: 'compacting' }
  | { readonly key: string; readonly sessionId: string; readonly phase: 'applying' }
  | { readonly key: string; readonly sessionId: string; readonly phase: 'failed'; readonly failure: CompactionFailure }

/** One review's compaction state, readable while the composer re-renders. */
interface CompactionTasks {
  /**
   * Read one review's compaction state.
   * @param key - review request key.
   * @returns the current state, or undefined when that review has none.
   */
  read(key: string): CompactionTask | undefined
  /**
   * Read the compaction state of one session, if any.
   * @param sessionId - session being compacted.
   * @returns the current state, or undefined when that session has none.
   */
  ofSession(sessionId: string): CompactionTask | undefined
  /** @param listener - callback invoked after every state change. @returns the unsubscribe. */
  subscribe(listener: () => void): () => void
  /** @param key - review request key. @param sessionId - owning session. */
  begin(key: string, sessionId: string): void
  /** @param key - review request key. @param sessionId - owning session. */
  markApplying(key: string, sessionId: string): void
  /**
   * Record a failed attempt.
   * @param key - review request key.
   * @param sessionId - owning session.
   * @param failure - classified reason the plan did not run.
   */
  fail(key: string, sessionId: string, failure: CompactionFailure): void
  /** @param key - review request key. */
  clear(key: string): void
}

/**
 * The review carrier's own answer surface, as both host generations expose it.
 *
 * `answer` is the single settlement path of the Host waterfall the official
 * panel also answers through. `dismiss` and `snapshot` arrived with the 0.2.0
 * carrier: an answer that travels the Remote channel leaves the panel standing
 * until the answerer hides it, and `snapshot().channel` is how the carrier
 * reports which channel an answer would use.
 */
interface ReviewCarrier {
  /** @param answer - complete answer batch for the review's question. */
  answer(answer: { answers: { id: string; selected: string[] }[] }): Promise<void> | void
  /** 0.2.0 withdrawal of an answered review's panel. */
  dismiss?: () => Promise<void> | void
  /** 0.2.0 report of the channel an answer would use. */
  snapshot?: () => { channel?: string } | undefined
}

/** One request to compact a review and run its plan. */
interface CompactRequest {
  /** Narrowed review the official panel received as its owner props. */
  readonly review: PlanReview
  /** Review request identity, the key of every state this control keeps. */
  readonly requestKey: string
  /** The review's live carrier, or undefined when its interaction already left. */
  readonly carrier: ReviewCarrier | undefined
}

/** Business face this plugin's decision control registers. */
interface PlanCompactFace {
  /**
   * Compact the pre-plan history, then answer the review with the plan's own
   * approve label. Failures are recorded in the shared state and surfaced by
   * the control, so this never rejects.
   *
   * @param request - review to answer and its live carrier.
   */
  compactThenApprove: (request: CompactRequest) => void
}

/**
 * The session standard prop that resolves one host projection by key.
 *
 * Declared here rather than imported: the framework declares `useProjection` in
 * `@deepseek-ai/dsh-api-session-controller`, which this bundle does not depend
 * on, and the one projection this control reads is the token-meter's own
 * browser-safe contract. Spelling the key out keeps a renamed projection a
 * compile error instead of a silent `undefined`.
 */
type ProjectionReader = (key: 'contextPressure') => ContextPressureProjection | undefined

/** Fully composed props of the decision control. */
type PlanCompactActionProps = ComposedProps<
  'conversation.plan-review.actions',
  string,
  never,
  undefined,
  PlanCompactFace,
  never,
  typeof NS
>

/** Fully composed props of the compaction lock's progress card. */
type PlanCompactProgressProps = ComposedProps<
  'conversation.composer',
  string,
  never,
  undefined,
  object,
  PlanCompactLock,
  typeof NS
>

; (window as any).__ModuleLoader__.load({
  id: BUNDLE_ID,
  factory: (require: (specifier: string) => any) => {
    const bundleModule: { exports: Record<string, unknown> } = { exports: {} }
    Object.defineProperty(bundleModule.exports, Symbol.toStringTag, { value: 'Module' })

    // Shell seed words only: the bundle has no other module edges.
    const React = require('react') as typeof import('react')
    const primitives = require('@deepseek-ai/dsh-client-ui-primitives') as typeof import('@deepseek-ai/dsh-client-ui-primitives')

    // ── Stylesheet (the official card's tokens, for the progress card) ────────
    const css =
      // The official strip container (`.previewActions`) is a nowrap flex row with no
      // gap, and it is not ours to restyle. Two consequences drive these rules: the
      // separation from the official link is this control's own margin, and the
      // failure notice must take no layout width at all — an inline message would
      // squeeze the row until the decision button and the official link wrapped one
      // character per line. The notice therefore floats under the strip instead, and
      // is clipped by the card only if the card is shorter than its own summary.
      '.PCE_control{position:relative;flex:none;align-items:center;gap:8px;margin-right:10px;display:inline-flex}' +
      '.PCE_control .PCE_compact{gap:6px;white-space:nowrap;font-size:14px;font-weight:600;padding:0 12px}' +
      '.PCE_ring{flex:none}' +
      '.PCE_failure{position:absolute;top:calc(100% + 6px);right:0;z-index:1;width:max-content;max-width:min(360px,60vw);white-space:normal;color:var(--dsw-alias-state-error-primary);background:var(--dsw-specific-input-major);border:1px solid var(--dsw-alias-border-l2);border-radius:8px;box-shadow:var(--dsw-elevation-panel);padding:6px 8px;font-size:12px;line-height:16px}' +
      '.PCE_frame{padding:6px calc(var(--dsh-composer-side-clearance) + 16px) 10px;justify-content:center;display:flex}' +
      '.PCE_card{width:100%;max-width:var(--dsh-chat-content-width);--dsw-elevation-stroke-color:var(--dsw-alias-border-l2);border-radius:var(--dsw-radius-xl);background:var(--dsw-specific-input-major);box-shadow:var(--dsw-elevation-panel);color:var(--dsw-alias-label-primary);border:0;flex-direction:column;display:flex;overflow:hidden}' +
      '.PCE_card,.PCE_card *{box-sizing:border-box}' +
      '.PCE_strip{background:var(--dsw-alias-state-warn-tertiary);color:var(--dsw-alias-state-warn-primary);flex-shrink:0;align-items:center;gap:8px;padding:12px 16px;font-size:14px;line-height:20px;display:flex}' +
      '.PCE_summary{min-width:0;padding:14px 16px 12px}' +
      '.PCE_description{color:var(--dsw-alias-label-secondary);margin:0;font-size:14px;line-height:24px}' +
      '@media (width<=720px){.PCE_card{border-radius:var(--dsw-radius-xl)}}'
    const tagId = BUNDLE_ID + '/PlanCompactControl.css'
    if (typeof document !== 'undefined' && document.querySelector('style[data-plugin-css=' + JSON.stringify(tagId) + ']') === null) {
      const tag = document.createElement('style')
      tag.dataset.plugin = BUNDLE_ID
      tag.dataset.pluginCss = tagId
      tag.textContent = css
      document.head.appendChild(tag)
    }

    /**
     * Read one thrown value as a message.
     * @param cause - value thrown by a carrier verb or the Remote call.
     * @returns the error's message, or the value's own text.
     */
    function messageOf(cause: unknown): string {
      return cause instanceof Error ? cause.message : String(cause)
    }

    /**
     * Await one host call, but never longer than the deadline.
     *
     * @param call - host call to await.
     * @param deadlineMs - milliseconds after which the call is abandoned.
     * @returns how the wait ended, and the value when it settled.
     */
    function withinDeadline<T>(call: Promise<T>, deadlineMs: number): Promise<DeadlineOutcome<T>> {
      return new Promise((resolve) => {
        const timer = setTimeout(() => {
          resolve({ kind: 'expired' })
        }, deadlineMs)
        const settle = (outcome: DeadlineOutcome<T>): void => {
          clearTimeout(timer)
          resolve(outcome)
        }
        call.then(
          (value) => settle({ kind: 'settled', value }),
          (cause: unknown) => settle({ kind: 'rejected', cause }),
        )
      })
    }

    /**
     * Occupancy of the next request against the newest known route capacity.
     *
     * Mirrors the official composer meter's own resolution — `contextOccupancy`
     * in `@deepseek-ai/dsh-client-ui-conversation` — which this bundle may not
     * import: a bundled client may only require the shell seeds, so the formula
     * is repeated, and `test-official-parity.mjs` fails the day the official one
     * changes. `projectedTokens` is preferred because it follows the surface a
     * compaction has already rewritten, which is the difference this decision
     * is about.
     *
     * @param pressure - latest `contextPressure` projection value.
     * @returns display percentage in 0..100, or undefined until usage and capacity are both known.
     */
    function occupancyPercent(pressure: ContextPressureProjection | undefined): number | undefined {
      const used = pressure?.projectedTokens ?? pressure?.pressureTokens
      const window = pressure?.contextWindow
      if (used === undefined || window === undefined) return undefined
      return Math.min(100, Math.round(used / window * 100))
    }

    /**
     * Narrow one session's published pending interaction to the review carrier
     * this control answers.
     *
     * The published interaction is the highest-precedence one for the session,
     * which is the official question carrier — except while this plugin's own
     * lock holds the seat, and a lock is not answerable.
     *
     * @param value - interaction published for the control's session.
     * @returns the carrier, or undefined when no review is answerable there.
     */
    function reviewCarrier(value: SessionPendingInteraction | undefined): ReviewCarrier | undefined {
      if (value === undefined || value.kind === LOCK_KIND) return undefined
      return value as ReviewCarrier
    }

    /**
     * Whether an answer to this carrier travels the Remote channel, in which
     * case the carrier hides its own panel once the answer landed.
     *
     * @param carrier - carrier being answered.
     * @returns whether the carrier reports the Remote channel.
     */
    function answersOverRpc(carrier: ReviewCarrier): boolean {
      if (typeof carrier.snapshot !== 'function') return false
      return carrier.snapshot()?.channel === 'rpc'
    }

    /**
     * Localized copy of one failed attempt.
     * @param failure - classified reason the plan did not run.
     * @param t - this namespace's translator.
     * @returns the message the decision control shows.
     */
    function failureText(failure: CompactionFailure, t: (key: PlanCompactKey) => string): string {
      switch (failure.kind) {
        case 'compaction': return t('compactionFailedPrefix') + failure.message
        case 'answer': return t('answerFailedPrefix') + failure.message
        case 'timeout': return t('compactionTimedOut')
        case 'carrier-gone': return t('noCarrier')
        case 'status-sent': return t('statusSent')
      }
    }

    /** Create the per-activation compaction state shared by both entries. */
    function createCompactionTasks(): CompactionTasks {
      const tasks = new Map<string, CompactionTask>()
      const listeners = new Set<() => void>()
      const write = (task: CompactionTask): void => {
        tasks.set(task.key, task)
        for (const listener of [...listeners]) listener()
      }
      return {
        read: (key) => tasks.get(key),
        ofSession: (sessionId) => {
          for (const task of tasks.values()) if (task.sessionId === sessionId) return task
          return undefined
        },
        subscribe: (listener) => {
          listeners.add(listener)
          return () => {
            listeners.delete(listener)
          }
        },
        begin: (key, sessionId) => {
          write({ key, sessionId, phase: 'compacting' })
        },
        markApplying: (key, sessionId) => {
          write({ key, sessionId, phase: 'applying' })
        },
        fail: (key, sessionId, failure) => {
          write({ key, sessionId, phase: 'failed', failure })
        },
        clear: (key) => {
          if (tasks.delete(key)) for (const listener of [...listeners]) listener()
        },
      }
    }

    /** Holdings of one activation's compaction locks, keyed by review request key. */
    interface LockRegistry {
      /**
       * Publish the lock for one review, unless it is already held.
       * @param key - review request key.
       * @param sessionId - session whose composer the lock displaces.
       */
      acquire(key: string, sessionId: SessionId): void
      /** @param key - review request key whose lock should be withdrawn. */
      release(key: string): void
      /** Withdraw every lock this activation holds. */
      releaseAll(): void
    }

    /** Create the compaction lock registry. */
    function createLockRegistry(uiSession: UiSession): LockRegistry {
      const publish = uiSession.registerPendingInteraction<PlanCompactLock>(() => LOCK_PRECEDENCE)
      const holdings = new Map<string, () => void>()
      return {
        acquire: (key, sessionId) => {
          if (holdings.has(key)) return
          // The delegate runs when the registry tears the domain down; a lock
          // owns no Host request to hand back.
          holdings.set(key, publish({ key, kind: LOCK_KIND, sessionId }, async () => {}))
        },
        release: (key) => {
          const unpublish = holdings.get(key)
          if (unpublish === undefined) return
          holdings.delete(key)
          unpublish()
        },
        releaseAll: () => {
          for (const unpublish of [...holdings.values()]) unpublish()
          holdings.clear()
        },
      }
    }

    /**
     * Services required before the decision control can register.
     *
     * `uiSession` is a hard dependency rather than an optional lookup: it is what
     * publishes the review carrier this control answers through, and the composed
     * `useSessionStatus` prop it reads comes from the same plugin. A composition
     * without it has no plan review to decide at all.
     */
    const inject = ['slots', 'locale', 'remote', 'uiSession']

    /**
     * Register the dictionaries, the decision control, and the lock's progress
     * card. Without the host half's Remote namespace the control cannot compact
     * anything, so nothing is registered and the official card stays in charge.
     *
     * @param ctx - client root context.
     */
    async function apply(ctx: Context): Promise<void> {
      ctx.effect(() => ctx.locale.register(NS, { zh, en }), BUNDLE_ID + ': dictionaries')
      try {
        await ctx.remote.$mount(CONTRIBUTION)
      } catch (error) {
        // Without the mounted namespace the card cannot compact, so the official
        // two-decision plan review keeps rendering; the failure is worth a console
        // warning because the plugin otherwise looks installed but inert.
        console.warn(BUNDLE_ID + ': remote contribution did not mount; leaving the official plan-review card in place', error)
        return
      }
      const remote = ctx.get('remote.' + SERVICE_KEY) as
        | { compactBeforeExecute: (sessionId: string) => Promise<RemoteResult<CompactBeforeExecuteResult>> }
        | undefined
      if (remote === undefined) {
        console.warn(BUNDLE_ID + ': remote.planCompactExec is unavailable; leaving the official plan-review card in place')
        return
      }
      const gateway = remote

      const tasks = createCompactionTasks()
      const locks = createLockRegistry(ctx.uiSession)

      /**
       * Compact the reviewed session's pre-plan history and then run its plan.
       *
       * The review lock is taken for exactly as long as this runs, and every path
       * gives it back: each failure records why and returns, and the `finally`
       * releases whatever still holds it. Only a landed answer keeps the lock past
       * this function, so the official card cannot flash back while the answering
       * projection retires it.
       *
       * A hard failure keeps the review answerable and shows the diagnostic, so the
       * user can still approve without compaction. `nothing-to-compact` proceeds:
       * the host found no history worth replacing and logged why.
       *
       * @param input - review, session, and the review's live carrier.
       */
      async function compactThenApprove(input: CompactRequest & { sessionId: SessionId }): Promise<void> {
        const { review, requestKey, carrier } = input
        const sessionId = String(input.sessionId)
        const settled = tasks.read(requestKey)
        if (settled !== undefined && settled.phase !== 'failed') return

        if (carrier === undefined) {
          tasks.fail(requestKey, sessionId, { kind: 'carrier-gone' })
          return
        }

        tasks.begin(requestKey, sessionId)
        locks.acquire(requestKey, input.sessionId)
        let keepsLock = false
        try {
          const outcome = await withinDeadline(gateway.compactBeforeExecute(sessionId), COMPACTION_DEADLINE_MS)
          if (outcome.kind === 'expired') {
            tasks.fail(requestKey, sessionId, { kind: 'timeout' })
            return
          }
          if (outcome.kind === 'rejected') {
            tasks.fail(requestKey, sessionId, { kind: 'compaction', message: messageOf(outcome.cause) })
            return
          }
          if (!outcome.value.ok) {
            tasks.fail(requestKey, sessionId, { kind: 'compaction', message: outcome.value.error.message })
            return
          }

          try {
            await carrier.answer({ answers: [{ id: review.id, selected: [review.approve.label] }] })
          } catch (cause: unknown) {
            // The history was compacted, but this review can no longer be answered
            // (another surface settled it first), so the plan stays in plan mode.
            tasks.fail(requestKey, sessionId, { kind: 'answer', message: messageOf(cause) })
            return
          }

          tasks.markApplying(requestKey, sessionId)
          if (answersOverRpc(carrier) && typeof carrier.dismiss === 'function') {
            try {
              await carrier.dismiss()
            } catch {
              // The answer landed; only the carrier's own panel failed to close,
              // which is the official panel's `status.sent` case as well.
              tasks.fail(requestKey, sessionId, { kind: 'status-sent' })
              return
            }
          }
          keepsLock = true
          setTimeout(() => {
            tasks.clear(requestKey)
            locks.release(requestKey)
          }, SETTLE_GRACE_MS)
        } catch (cause: unknown) {
          // Nothing below the deadline is expected to throw; if something does, the
          // review must not stay locked behind it.
          tasks.fail(requestKey, sessionId, { kind: 'compaction', message: messageOf(cause) })
        } finally {
          if (!keepsLock) locks.release(requestKey)
        }
      }

      /**
       * Render the decision's leading icon: the official compact mark, or — once
       * a reading exists — that mark's ring drawn as the current occupancy.
       *
       * The track is the official artwork's own faded circle so the two look like
       * one control; the arc starts at twelve o'clock and runs clockwise, the
       * direction the official composer meter's ring runs. A session with no
       * reading keeps the untouched mark rather than an empty ring, which would
       * read as a measured zero.
       *
       * @param props.percent - occupancy in whole percent, or undefined without a reading.
       * @returns the 14px icon node for the decision button.
       */
      function ContextRing({ percent }: { percent: number | undefined }): ReactNode {
        if (percent === undefined) return <primitives.IconCompactOutlineRegular size={14} />
        return (
          <svg
            className="PCE_ring"
            width={14}
            height={14}
            viewBox={`0 0 ${RING_VIEWBOX} ${RING_VIEWBOX}`}
            aria-hidden={true}
          >
            <circle
              cx={RING_CENTER}
              cy={RING_CENTER}
              r={RING_RADIUS}
              fill="none"
              stroke="currentColor"
              strokeWidth={RING_STROKE_WIDTH}
              opacity={RING_TRACK_OPACITY}
            />
            {percent <= 0 ? null : (
              <circle
                cx={RING_CENTER}
                cy={RING_CENTER}
                r={RING_RADIUS}
                fill="none"
                stroke="currentColor"
                strokeWidth={RING_STROKE_WIDTH}
                strokeLinecap="round"
                strokeDasharray={`${RING_CIRCUMFERENCE * percent / 100} ${RING_CIRCUMFERENCE}`}
                transform={`rotate(-90 ${RING_CENTER} ${RING_CENTER})`}
              />
            )}
          </svg>
        )
      }

      /**
       * Render the third decision beside the official controls.
       * @param props - review owner props, business face, and localized copy.
       * @returns the decision control.
       */
      function PlanCompactAction(props: PlanCompactActionProps): ReactNode {
        const t = props.t
        const { requestKey, review, sessionId } = props
        const task = React.useSyncExternalStore(tasks.subscribe, () => tasks.read(requestKey))
        const busy = task !== undefined && task.phase !== 'failed'
        // Read at click time: the carrier is the review's own live interaction,
        // and answering through it is the only way to settle the request.
        const carrier = props.useSessionStatus((status) => reviewCarrier(status.get(sessionId)?.pendingInteraction))
        const readPressure = props.useProjection as ProjectionReader
        const percent = occupancyPercent(readPressure('contextPressure'))
        const failure = task?.phase === 'failed' ? failureText(task.failure, t) : undefined
        const label = task?.phase === 'applying'
          ? t('progressApplying')
          : busy ? t('compacting') : t('compactExecute')

        return (
          <span className="PCE_control">
            <primitives.Button
              variant="outline"
              size="sm"
              className="PCE_compact"
              title={percent === undefined ? t('compactHint') : t('compactHintUsage', { percent: percent + '%' })}
              disabled={busy}
              icon={<ContextRing percent={percent} />}
              onClick={() => {
                props.compactThenApprove({ review, requestKey, carrier })
              }}
            >
              {label}
            </primitives.Button>
            {failure === undefined ? null : (
              <span className="PCE_failure" role="status" title={failure}>
                {failure}
              </span>
            )}
          </span>
        )
      }

      /**
       * Render the lock's progress card, which is what the composer shows
       * instead of the official decisions while the compaction runs.
       *
       * @param props - session identity, the lock that elected this entry, and copy.
       * @returns the progress card.
       */
      function PlanCompactProgress(props: PlanCompactProgressProps): ReactNode {
        const t = props.t
        const sessionId = String(props.sessionId)
        const task = React.useSyncExternalStore(tasks.subscribe, () => tasks.ofSession(sessionId))
        // A failed attempt holds no lock, so its card is never elected; rendering
        // nothing for it keeps a stale record from claiming to still be compacting.
        if (task === undefined || task.phase === 'failed') return null
        const applying = task.phase === 'applying'
        return (
          <div className="PCE_frame">
            <section className="PCE_card" aria-busy="true" aria-live="polite">
              <div className="PCE_strip">
                <primitives.StateDot state="ongoing" />
                {t(applying ? 'progressApplying' : 'progressCompacting')}
              </div>
              {applying ? null : (
                <div className="PCE_summary">
                  <p className="PCE_description">{t('progressNote')}</p>
                </div>
              )}
            </section>
          </div>
        )
      }

      ctx.effect(() => () => locks.releaseAll(), BUNDLE_ID + ': compaction locks')
      ctx.slots.inject(SLOT_REVIEW_ACTIONS, () =>
        ctx.slots.register(
          {
            name: SLOT_REVIEW_ACTIONS,
            id: BUNDLE_ID,
            // Before the official "full plan" link, whatever order the two plugins load in.
            order: -1,
            locale: NS,
            inject: (sessionId) => ({
              compactThenApprove: (request: CompactRequest) => {
                void compactThenApprove({ ...request, sessionId })
              },
            }),
          },
          PlanCompactAction,
        ),
      )
      ctx.slots.inject(SLOT_COMPOSER, () =>
        ctx.slots.register(
          {
            name: SLOT_COMPOSER,
            // Tried before the official entries: the lock's interaction is the
            // only one this selector claims, and every other carrier declines.
            priority: -1,
            select: ({ pendingInteraction }) =>
              pendingInteraction !== undefined && pendingInteraction.kind === LOCK_KIND ? pendingInteraction : null,
            locale: NS,
          },
          PlanCompactProgress,
        ),
      )
    }

    // ── Remote contribution ─────────────────────────────────────────────────
    // Client-side codecs only satisfy the boundary checks; strict validation is
    // the host manifest's job. Both codec generations are carried at once.
    const identity = (value: unknown): unknown => value
    const strictSchema = { parse: identity }
    const clientCodec = (typeSymbol: string) => ({
      mode: 'strict' as const,
      typeSymbol,
      schema: strictSchema,
      create: () => strictSchema,
    })

    const CONTRIBUTION = {
      package: BUNDLE_ID,
      descriptors: [
        {
          id: BUNDLE_ID + '#' + SERVICE_KEY + '/' + METHOD_NAME,
          service: SERVICE_KEY,
          namespace: SERVICE_KEY,
          method: METHOD_NAME,
          invocation: { kind: 'direct' as const },
          parameters: [
            {
              name: 'sessionId',
              wire: 'sessionId',
              source: 'json' as const,
              codec: clientCodec(BUNDLE_ID + '#SessionId'),
            },
          ],
          result: clientCodec(BUNDLE_ID + '#CompactBeforeExecuteResult'),
        },
      ],
    }

    bundleModule.exports.apply = apply
    bundleModule.exports.inject = inject
    return bundleModule.exports
  },
})
