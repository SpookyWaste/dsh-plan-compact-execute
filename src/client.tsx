/**
 * Browser half of `dsh-plan-compact-execute`: the plan-review card with a
 * "Compact and run" option.
 *
 * The official `PlanReviewPanel` renders exactly two decision buttons and
 * exposes only one child slot (the card header's preview actions), so a third
 * decision is a composer takeover: this plugin elects `conversation.composer`
 * for `plan-review` carriers with `priority: -1`, ahead of the official entry's
 * default `0`, and renders the same card with three buttons in its action row.
 * Electing is skipped entirely while the host half's remote namespace is
 * unavailable, which leaves the official two-button card in charge.
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
import type { PendingQuestion, PlanReview } from '@deepseek-ai/dsh-client-ui-user-questions/client'
import type { RemoteResult, TypertRemoteContribution } from '@deepseek-ai/dsh-typert-protocol'
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

/** Simplified Chinese dictionary (the key-set source of truth). */
const zh = {
  'header': '计划待审',
  'discuss': '要求修改',
  'approve': '同意执行',
  'compactExecute': '压缩后执行',
  'compacting': '压缩中…',
  'compactHint': '把计划提交前的历史压缩成摘要，然后立即执行计划',
  'errorPrefix': '压缩失败：',
}

/** English dictionary, checked complete against the zh key set. */
const en: Record<keyof typeof zh, string> = {
  'header': 'Plan review',
  'discuss': 'Request changes',
  'approve': 'Approve',
  'compactExecute': 'Compact and run',
  'compacting': 'Compacting…',
  'compactHint': 'Compact the history submitted before the plan, then run it immediately',
  'errorPrefix': 'Compaction failed: ',
}

/** This namespace's key union. */
type PlanCompactKey = keyof typeof zh

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** The plan-review takeover's copy. */
    planCompact: PlanCompactKey
  }
}

/** Business face the composer entry exposes to its own component. */
interface PlanCompactFace {
  /**
   * Compact the reviewed session's pre-plan history on the host.
   * @param sessionId - session whose pending plan review is being answered.
   * @returns the host result, or its classified failure.
   */
  compactBeforeExecute: (sessionId: string) => Promise<RemoteResult<CompactBeforeExecuteResult>>
}

/** Fully composed props of this plugin's composer entry. */
type PlanCompactPanelProps = ComposedProps<
  'conversation.composer',
  string,
  'conversation.plan-review.actions',
  undefined,
  PlanCompactFace,
  PendingQuestion,
  typeof NS
>

/** Which decision the card is currently settling. */
type Busy = 'discuss' | 'approve' | 'compact'

;(window as any).__ModuleLoader__.load({
  id: BUNDLE_ID,
  factory: (require: (specifier: string) => any) => {
    const bundleModule: { exports: Record<string, unknown> } = { exports: {} }
    Object.defineProperty(bundleModule.exports, Symbol.toStringTag, { value: 'Module' })

    // Shell seed words only: the bundle has no other module edges.
    const React = require('react') as typeof import('react')
    const primitives = require('@deepseek-ai/dsh-client-ui-primitives') as typeof import('@deepseek-ai/dsh-client-ui-primitives')

    // ── Stylesheet (mirrors the official plan-review card) ────────────────────
    const css =
      '.PCE_frame{padding:6px calc(var(--dsh-composer-side-clearance) + 16px) 10px;justify-content:center;display:flex}' +
      '.PCE_card{width:100%;max-width:var(--dsh-chat-content-width);--dsw-elevation-stroke-color:var(--dsw-alias-border-l2);border-radius:var(--dsw-radius-xl);background:var(--dsw-specific-input-major);box-shadow:var(--dsw-elevation-panel);color:var(--dsw-alias-label-primary);border:0;flex-direction:column;display:flex;overflow:hidden}' +
      '.PCE_card,.PCE_card *{box-sizing:border-box}' +
      '.PCE_strip{background:var(--dsw-alias-state-warn-tertiary);color:var(--dsw-alias-state-warn-primary);flex-shrink:0;align-items:center;gap:8px;padding:12px 16px;font-size:14px;line-height:20px;display:flex}' +
      '.PCE_footer{flex-shrink:0;justify-content:space-between;align-items:center;gap:12px;padding:8px 16px 12px;display:flex}' +
      '.PCE_feedback{min-height:16px;color:var(--dsw-alias-state-error-primary);font-size:11px;line-height:16px}' +
      '.PCE_actions{flex-shrink:0;align-items:center;gap:8px;display:flex}' +
      '.PCE_summary{min-width:0;padding:14px 16px 12px}' +
      '.PCE_title{text-overflow:ellipsis;white-space:nowrap;margin:0;font-size:15px;font-weight:500;line-height:22px;overflow:hidden}' +
      '.PCE_description{-webkit-line-clamp:2;color:var(--dsw-alias-label-secondary);-webkit-box-orient:vertical;margin:8px 0 0;font-size:14px;line-height:24px;display:-webkit-box;overflow:hidden}' +
      '.PCE_discuss{gap:6px}' +
      '.PCE_compact{gap:6px}' +
      '@media (width<=720px){.PCE_card{border-radius:var(--dsw-radius-xl)}.PCE_footer{align-items:flex-end;padding:8px 12px 10px}}' +
      '.PCE_previewActions{align-items:center;margin-left:auto;display:flex}'
    const tagId = BUNDLE_ID + '/PlanCompactPanel.css'
    if (typeof document !== 'undefined' && document.querySelector('style[data-plugin-css=' + JSON.stringify(tagId) + ']') === null) {
      const tag = document.createElement('style')
      tag.dataset.plugin = BUNDLE_ID
      tag.dataset.pluginCss = tagId
      tag.textContent = css
      document.head.appendChild(tag)
    }

    // ── Review narrowing (the official card's `planReviewOf` contract) ───────
    /**
     * Narrow one pending carrier to the review this card renders and answers.
     *
     * Same acceptance rule the official panel uses: one question carrying the
     * plan as its detail, no multi-select, and the intent's approve label naming
     * one of that question's own options.
     *
     * @param pending - pending plan-review carrier published by the question composer.
     * @returns the narrowed review, or undefined when the carrier is malformed.
     */
    function narrowPlanReview(pending: PendingQuestion): PlanReview | undefined {
      const questions = pending.questions
      if (questions.length !== 1) return undefined
      const question = questions[0]
      const intent = question.intent
      if (intent?.kind !== 'plan-review' || question.detail === undefined) return undefined
      if (question.multiSelect === true) return undefined
      const options = question.options ?? []
      const approve = options.find((option) => option.label === intent.approve)
      if (approve === undefined) return undefined
      const decline = options.find((option) => option.label !== intent.approve)
      return {
        id: question.id,
        question: question.question,
        plan: question.detail,
        ...(intent.callId === undefined ? {} : { callId: intent.callId }),
        approve,
        ...(decline === undefined ? {} : { decline }),
      }
    }

    /** Optional-prop spread for a decision button's tooltip. */
    function tooltip(description: string | undefined): { title?: string } {
      return description === undefined ? {} : { title: description }
    }

    /**
     * Render the plan-review card with its third decision.
     * @param props - carrier, business face, localized copy, and child-slot renderer.
     * @returns the takeover, or null for a carrier this card cannot render.
     */
    function PlanCompactPanel(props: PlanCompactPanelProps): ReactNode {
      const pending = props.matched
      const review = React.useMemo(() => narrowPlanReview(pending), [pending])
      const [busy, setBusy] = React.useState<Busy | null>(null)
      const [error, setError] = React.useState<string | null>(null)
      const t = props.t

      const summary = React.useMemo(() => {
        if (review === undefined) return { title: '', description: '' }
        const title = primitives.extractMarkdownPlainText(review.plan, { mode: 'first-line' })
        const description = primitives.extractMarkdownPlainText(review.plan, { mode: 'first-paragraph' })
        return { title, description: description === title ? '' : description }
      }, [review])

      if (review === undefined) return null

      /** Run one decision, disabling the whole row until it settles. */
      const settle = (kind: Busy, send: () => Promise<void>): void => {
        setBusy(kind)
        setError(null)
        send().catch((cause: unknown) => {
          setBusy(null)
          setError(cause instanceof Error ? cause.message : String(cause))
        })
      }

      const decide = (label: string): void => {
        settle('approve', () => pending.answer({ answers: [{ id: review.id, selected: [label] }] }))
      }

      /**
       * Compact the pre-plan history, then approve the plan with its own label.
       *
       * A hard failure keeps the review pending and shows the host diagnostic, so
       * the user can still approve without compaction. `nothing-to-compact` simply
       * proceeds: there was no history worth replacing, and the host logged why.
       */
      const compactThenExecute = (): void => {
        settle('compact', async () => {
          const result = await props.compactBeforeExecute(String(props.sessionId))
          if (!result.ok) throw new Error(result.error.message)
          await pending.answer({ answers: [{ id: review.id, selected: [review.approve.label] }] })
        })
      }

      return (
        <div className="PCE_frame" data-plan-review-key={pending.key}>
          <section className="PCE_card" aria-label={review.question} aria-busy={busy !== null}>
            <div className="PCE_strip">
              <primitives.StateDot state={busy !== null ? 'ongoing' : 'warning'} />
              {t('header')}
              <div className="PCE_previewActions">
                {props.renderSlot('conversation.plan-review.actions', { review, requestKey: pending.key })}
              </div>
            </div>
            <div className="PCE_summary">
              <h3 className="PCE_title">{summary.title}</h3>
              {summary.description !== '' && <p className="PCE_description">{summary.description}</p>}
            </div>
            <div className="PCE_footer">
              <div className="PCE_feedback" role="status">
                {error === null ? null : t('errorPrefix') + error}
              </div>
              <div className="PCE_actions">
                <primitives.Button
                  variant="outline"
                  className="PCE_discuss"
                  icon={<primitives.IconEditOutlineRegular size={14} />}
                  disabled={busy !== null}
                  onClick={() => {
                    settle('discuss', () => pending.cancel())
                  }}
                >
                  {t('discuss')}
                </primitives.Button>
                <primitives.Button
                  variant="outline"
                  className="PCE_compact"
                  icon={<primitives.IconCompactOutlineRegular size={14} />}
                  title={t('compactHint')}
                  disabled={busy !== null}
                  onClick={compactThenExecute}
                >
                  {busy === 'compact' ? t('compacting') : t('compactExecute')}
                </primitives.Button>
                <primitives.Button
                  variant="primary"
                  {...tooltip(review.approve.description)}
                  disabled={busy !== null}
                  onClick={() => {
                    decide(review.approve.label)
                  }}
                >
                  {t('approve')}
                </primitives.Button>
              </div>
            </div>
          </section>
        </div>
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

    const CONTRIBUTION: TypertRemoteContribution = {
      package: BUNDLE_ID,
      descriptors: [
        {
          id: BUNDLE_ID + '#' + SERVICE_KEY + '/' + METHOD_NAME,
          service: SERVICE_KEY,
          namespace: SERVICE_KEY,
          method: METHOD_NAME,
          invocation: { kind: 'direct' },
          parameters: [
            {
              name: 'sessionId',
              wire: 'sessionId',
              source: 'json',
              codec: clientCodec(BUNDLE_ID + '#SessionId'),
            },
          ],
          result: clientCodec(BUNDLE_ID + '#CompactBeforeExecuteResult'),
        },
      ],
    }

    /** Services required before the takeover can register. */
    const inject = ['slots', 'locale', 'remote']

    /**
     * Register the dictionaries and, while the host half answers, the takeover.
     * @param ctx - client root context.
     */
    async function apply(ctx: Context): Promise<void> {
      ctx.effect(() => ctx.locale.register(NS, { zh, en }), BUNDLE_ID + ': dictionaries')
      try {
        await ctx.remote.$mount(CONTRIBUTION)
      } catch (error) {
        // Without the mounted namespace the card cannot compact, so the official
        // two-button plan review keeps rendering; the failure is worth a console
        // warning because the plugin otherwise looks installed but inert.
        console.warn(BUNDLE_ID + ': remote contribution did not mount; leaving the official plan-review card in place', error)
        return
      }
      const remote = ctx.get('remote.' + SERVICE_KEY) as PlanCompactFace | undefined
      if (remote === undefined) {
        console.warn(BUNDLE_ID + ': remote.planCompactExec is unavailable; leaving the official plan-review card in place')
        return
      }
      ctx.slots.inject('conversation.composer', () =>
        ctx.slots.register(
          {
            name: 'conversation.composer',
            priority: -1,
            select: ({ pendingInteraction }) =>
              pendingInteraction !== undefined &&
              pendingInteraction.kind === 'plan-review' &&
              narrowPlanReview(pendingInteraction) !== undefined
                ? pendingInteraction
                : null,
            locale: NS,
            inject: () => ({
              compactBeforeExecute: (sessionId: string) => remote.compactBeforeExecute(sessionId),
            }),
            children: { 'conversation.plan-review.actions': { kind: 'list', scope: 'session' } },
          },
          PlanCompactPanel,
        ),
      )
    }

    bundleModule.exports.apply = apply
    bundleModule.exports.inject = inject
    return bundleModule.exports
  },
})