/** Browser module id; must equal the package name for the boot graph to match. */
const BUNDLE_ID = 'dsh-plan-compact-execute';
/** Dictionary namespace owned by this plugin. */
const NS = 'planCompact';
/** Remote method name; mirrors `protocol.ts` for the browser bundle. */
const METHOD_NAME = 'compactBeforeExecute';
/** Wire namespace; mirrors `protocol.ts` for the browser bundle. */
const SERVICE_KEY = 'planCompactExec';
/** Official strip slot this plugin contributes its decision to. */
const SLOT_REVIEW_ACTIONS = 'conversation.plan-review.actions';
/** Official composer chain the compaction lock's progress card is elected from. */
const SLOT_COMPOSER = 'conversation.composer';
/**
 * Presentation kind of the compaction lock.
 *
 * Deliberately a kind of its own: the official domains publish `question` and
 * `plan-review`, the composer chain discriminates carriers with `instanceof`,
 * and the workspace status presentation only recognises the three official
 * kinds and ignores everything else, so a distinct kind displaces the official
 * card without being mistaken for one.
 */
const LOCK_KIND = 'plan-compact';
/**
 * Precedence of the compaction lock, above the official domains (plan review 2,
 * question 1). Higher precedence wins for the session, which is what removes
 * the official panel from the composer while the compaction runs.
 */
const LOCK_PRECEDENCE = 3;
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
const COMPACTION_DEADLINE_MS = 5 * 60 * 1000;
/**
 * How long the lock outlives a landed answer.
 *
 * Answering settles the request, but the official card leaves the composer only
 * after the answering projection reaches the client. Releasing the lock first
 * would flash the official two-button panel back for that round trip, so the
 * progress card covers it instead.
 */
const SETTLE_GRACE_MS = 400;
/** Simplified Chinese dictionary (the key-set source of truth). */
const zh = {
    'compactExecute': '压缩后执行',
    'compacting': '压缩中…',
    'compactHint': '把计划提交前的历史压缩成摘要，然后立即执行计划',
    'compactionFailedPrefix': '压缩失败：',
    'compactionTimedOut': '压缩超时，已解除锁定，可以重试。',
    'answerFailedPrefix': '未能执行计划：',
    'noCarrier': '这条计划审阅已经结束。',
    'statusSent': '回答已发送；面板未能关闭。',
    'progressCompacting': '正在压缩上下文',
    'progressApplying': '正在执行计划',
    'progressNote': '压缩完成后会立即执行计划。',
};
/** English dictionary, checked complete against the zh key set. */
const en = {
    'compactExecute': 'Compact and run',
    'compacting': 'Compacting…',
    'compactHint': 'Compact the history submitted before the plan, then run it immediately',
    'compactionFailedPrefix': 'Compaction failed: ',
    'compactionTimedOut': 'The compaction timed out; the lock is released and you can try again.',
    'answerFailedPrefix': 'The plan was not run: ',
    'noCarrier': 'This plan review has already ended.',
    'statusSent': 'Reply sent; the panel could not close.',
    'progressCompacting': 'Compacting the context',
    'progressApplying': 'Running the plan',
    'progressNote': 'The plan runs as soon as the compaction finishes.',
};
window.__ModuleLoader__.load({
    id: BUNDLE_ID,
    factory: (require) => {
        const bundleModule = { exports: {} };
        Object.defineProperty(bundleModule.exports, Symbol.toStringTag, { value: 'Module' });
        // Shell seed words only: the bundle has no other module edges.
        const React = require('react');
        const primitives = require('@deepseek-ai/dsh-client-ui-primitives');
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
            '.PCE_failure{position:absolute;top:calc(100% + 6px);right:0;z-index:1;width:max-content;max-width:min(360px,60vw);white-space:normal;color:var(--dsw-alias-state-error-primary);background:var(--dsw-specific-input-major);border:1px solid var(--dsw-alias-border-l2);border-radius:8px;box-shadow:var(--dsw-elevation-panel);padding:6px 8px;font-size:12px;line-height:16px}' +
            '.PCE_frame{padding:6px calc(var(--dsh-composer-side-clearance) + 16px) 10px;justify-content:center;display:flex}' +
            '.PCE_card{width:100%;max-width:var(--dsh-chat-content-width);--dsw-elevation-stroke-color:var(--dsw-alias-border-l2);border-radius:var(--dsw-radius-xl);background:var(--dsw-specific-input-major);box-shadow:var(--dsw-elevation-panel);color:var(--dsw-alias-label-primary);border:0;flex-direction:column;display:flex;overflow:hidden}' +
            '.PCE_card,.PCE_card *{box-sizing:border-box}' +
            '.PCE_strip{background:var(--dsw-alias-state-warn-tertiary);color:var(--dsw-alias-state-warn-primary);flex-shrink:0;align-items:center;gap:8px;padding:12px 16px;font-size:14px;line-height:20px;display:flex}' +
            '.PCE_summary{min-width:0;padding:14px 16px 12px}' +
            '.PCE_description{color:var(--dsw-alias-label-secondary);margin:0;font-size:14px;line-height:24px}' +
            '@media (width<=720px){.PCE_card{border-radius:var(--dsw-radius-xl)}}';
        const tagId = BUNDLE_ID + '/PlanCompactControl.css';
        if (typeof document !== 'undefined' && document.querySelector('style[data-plugin-css=' + JSON.stringify(tagId) + ']') === null) {
            const tag = document.createElement('style');
            tag.dataset.plugin = BUNDLE_ID;
            tag.dataset.pluginCss = tagId;
            tag.textContent = css;
            document.head.appendChild(tag);
        }
        /**
         * Read one thrown value as a message.
         * @param cause - value thrown by a carrier verb or the Remote call.
         * @returns the error's message, or the value's own text.
         */
        function messageOf(cause) {
            return cause instanceof Error ? cause.message : String(cause);
        }
        /**
         * Await one host call, but never longer than the deadline.
         *
         * @param call - host call to await.
         * @param deadlineMs - milliseconds after which the call is abandoned.
         * @returns how the wait ended, and the value when it settled.
         */
        function withinDeadline(call, deadlineMs) {
            return new Promise((resolve) => {
                const timer = setTimeout(() => {
                    resolve({ kind: 'expired' });
                }, deadlineMs);
                const settle = (outcome) => {
                    clearTimeout(timer);
                    resolve(outcome);
                };
                call.then((value) => settle({ kind: 'settled', value }), (cause) => settle({ kind: 'rejected', cause }));
            });
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
        function reviewCarrier(value) {
            if (value === undefined || value.kind === LOCK_KIND)
                return undefined;
            return value;
        }
        /**
         * Whether an answer to this carrier travels the Remote channel, in which
         * case the carrier hides its own panel once the answer landed.
         *
         * @param carrier - carrier being answered.
         * @returns whether the carrier reports the Remote channel.
         */
        function answersOverRpc(carrier) {
            if (typeof carrier.snapshot !== 'function')
                return false;
            return carrier.snapshot()?.channel === 'rpc';
        }
        /**
         * Localized copy of one failed attempt.
         * @param failure - classified reason the plan did not run.
         * @param t - this namespace's translator.
         * @returns the message the decision control shows.
         */
        function failureText(failure, t) {
            switch (failure.kind) {
                case 'compaction': return t('compactionFailedPrefix') + failure.message;
                case 'answer': return t('answerFailedPrefix') + failure.message;
                case 'timeout': return t('compactionTimedOut');
                case 'carrier-gone': return t('noCarrier');
                case 'status-sent': return t('statusSent');
            }
        }
        /** Create the per-activation compaction state shared by both entries. */
        function createCompactionTasks() {
            const tasks = new Map();
            const listeners = new Set();
            const write = (task) => {
                tasks.set(task.key, task);
                for (const listener of [...listeners])
                    listener();
            };
            return {
                read: (key) => tasks.get(key),
                ofSession: (sessionId) => {
                    for (const task of tasks.values())
                        if (task.sessionId === sessionId)
                            return task;
                    return undefined;
                },
                subscribe: (listener) => {
                    listeners.add(listener);
                    return () => {
                        listeners.delete(listener);
                    };
                },
                begin: (key, sessionId) => {
                    write({ key, sessionId, phase: 'compacting' });
                },
                markApplying: (key, sessionId) => {
                    write({ key, sessionId, phase: 'applying' });
                },
                fail: (key, sessionId, failure) => {
                    write({ key, sessionId, phase: 'failed', failure });
                },
                clear: (key) => {
                    if (tasks.delete(key))
                        for (const listener of [...listeners])
                            listener();
                },
            };
        }
        /** Create the compaction lock registry. */
        function createLockRegistry(uiSession) {
            const publish = uiSession.registerPendingInteraction(() => LOCK_PRECEDENCE);
            const holdings = new Map();
            return {
                acquire: (key, sessionId) => {
                    if (holdings.has(key))
                        return;
                    // The delegate runs when the registry tears the domain down; a lock
                    // owns no Host request to hand back.
                    holdings.set(key, publish({ key, kind: LOCK_KIND, sessionId }, async () => { }));
                },
                release: (key) => {
                    const unpublish = holdings.get(key);
                    if (unpublish === undefined)
                        return;
                    holdings.delete(key);
                    unpublish();
                },
                releaseAll: () => {
                    for (const unpublish of [...holdings.values()])
                        unpublish();
                    holdings.clear();
                },
            };
        }
        /**
         * Services required before the decision control can register.
         *
         * `uiSession` is a hard dependency rather than an optional lookup: it is what
         * publishes the review carrier this control answers through, and the composed
         * `useSessionStatus` prop it reads comes from the same plugin. A composition
         * without it has no plan review to decide at all.
         */
        const inject = ['slots', 'locale', 'remote', 'uiSession'];
        /**
         * Register the dictionaries, the decision control, and the lock's progress
         * card. Without the host half's Remote namespace the control cannot compact
         * anything, so nothing is registered and the official card stays in charge.
         *
         * @param ctx - client root context.
         */
        async function apply(ctx) {
            ctx.effect(() => ctx.locale.register(NS, { zh, en }), BUNDLE_ID + ': dictionaries');
            try {
                await ctx.remote.$mount(CONTRIBUTION);
            }
            catch (error) {
                // Without the mounted namespace the card cannot compact, so the official
                // two-decision plan review keeps rendering; the failure is worth a console
                // warning because the plugin otherwise looks installed but inert.
                console.warn(BUNDLE_ID + ': remote contribution did not mount; leaving the official plan-review card in place', error);
                return;
            }
            const remote = ctx.get('remote.' + SERVICE_KEY);
            if (remote === undefined) {
                console.warn(BUNDLE_ID + ': remote.planCompactExec is unavailable; leaving the official plan-review card in place');
                return;
            }
            const gateway = remote;
            const tasks = createCompactionTasks();
            const locks = createLockRegistry(ctx.uiSession);
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
            async function compactThenApprove(input) {
                const { review, requestKey, carrier } = input;
                const sessionId = String(input.sessionId);
                const settled = tasks.read(requestKey);
                if (settled !== undefined && settled.phase !== 'failed')
                    return;
                if (carrier === undefined) {
                    tasks.fail(requestKey, sessionId, { kind: 'carrier-gone' });
                    return;
                }
                tasks.begin(requestKey, sessionId);
                locks.acquire(requestKey, input.sessionId);
                let keepsLock = false;
                try {
                    const outcome = await withinDeadline(gateway.compactBeforeExecute(sessionId), COMPACTION_DEADLINE_MS);
                    if (outcome.kind === 'expired') {
                        tasks.fail(requestKey, sessionId, { kind: 'timeout' });
                        return;
                    }
                    if (outcome.kind === 'rejected') {
                        tasks.fail(requestKey, sessionId, { kind: 'compaction', message: messageOf(outcome.cause) });
                        return;
                    }
                    if (!outcome.value.ok) {
                        tasks.fail(requestKey, sessionId, { kind: 'compaction', message: outcome.value.error.message });
                        return;
                    }
                    try {
                        await carrier.answer({ answers: [{ id: review.id, selected: [review.approve.label] }] });
                    }
                    catch (cause) {
                        // The history was compacted, but this review can no longer be answered
                        // (another surface settled it first), so the plan stays in plan mode.
                        tasks.fail(requestKey, sessionId, { kind: 'answer', message: messageOf(cause) });
                        return;
                    }
                    tasks.markApplying(requestKey, sessionId);
                    if (answersOverRpc(carrier) && typeof carrier.dismiss === 'function') {
                        try {
                            await carrier.dismiss();
                        }
                        catch {
                            // The answer landed; only the carrier's own panel failed to close,
                            // which is the official panel's `status.sent` case as well.
                            tasks.fail(requestKey, sessionId, { kind: 'status-sent' });
                            return;
                        }
                    }
                    keepsLock = true;
                    setTimeout(() => {
                        tasks.clear(requestKey);
                        locks.release(requestKey);
                    }, SETTLE_GRACE_MS);
                }
                catch (cause) {
                    // Nothing below the deadline is expected to throw; if something does, the
                    // review must not stay locked behind it.
                    tasks.fail(requestKey, sessionId, { kind: 'compaction', message: messageOf(cause) });
                }
                finally {
                    if (!keepsLock)
                        locks.release(requestKey);
                }
            }
            /**
             * Render the third decision beside the official controls.
             * @param props - review owner props, business face, and localized copy.
             * @returns the decision control.
             */
            function PlanCompactAction(props) {
                const t = props.t;
                const { requestKey, review, sessionId } = props;
                const task = React.useSyncExternalStore(tasks.subscribe, () => tasks.read(requestKey));
                const busy = task !== undefined && task.phase !== 'failed';
                // Read at click time: the carrier is the review's own live interaction,
                // and answering through it is the only way to settle the request.
                const carrier = props.useSessionStatus((status) => reviewCarrier(status.get(sessionId)?.pendingInteraction));
                const failure = task?.phase === 'failed' ? failureText(task.failure, t) : undefined;
                const label = task?.phase === 'applying'
                    ? t('progressApplying')
                    : busy ? t('compacting') : t('compactExecute');
                return (React.createElement("span", { className: "PCE_control" },
                    React.createElement(primitives.Button, { variant: "outline", size: "sm", className: "PCE_compact", title: t('compactHint'), disabled: busy, icon: React.createElement(primitives.IconCompactOutlineRegular, { size: 14 }), onClick: () => {
                            props.compactThenApprove({ review, requestKey, carrier });
                        } }, label),
                    failure === undefined ? null : (React.createElement("span", { className: "PCE_failure", role: "status", title: failure }, failure))));
            }
            /**
             * Render the lock's progress card, which is what the composer shows
             * instead of the official decisions while the compaction runs.
             *
             * @param props - session identity, the lock that elected this entry, and copy.
             * @returns the progress card.
             */
            function PlanCompactProgress(props) {
                const t = props.t;
                const sessionId = String(props.sessionId);
                const task = React.useSyncExternalStore(tasks.subscribe, () => tasks.ofSession(sessionId));
                // A failed attempt holds no lock, so its card is never elected; rendering
                // nothing for it keeps a stale record from claiming to still be compacting.
                if (task === undefined || task.phase === 'failed')
                    return null;
                const applying = task.phase === 'applying';
                return (React.createElement("div", { className: "PCE_frame" },
                    React.createElement("section", { className: "PCE_card", "aria-busy": "true", "aria-live": "polite" },
                        React.createElement("div", { className: "PCE_strip" },
                            React.createElement(primitives.StateDot, { state: "ongoing" }),
                            t(applying ? 'progressApplying' : 'progressCompacting')),
                        applying ? null : (React.createElement("div", { className: "PCE_summary" },
                            React.createElement("p", { className: "PCE_description" }, t('progressNote')))))));
            }
            ctx.effect(() => () => locks.releaseAll(), BUNDLE_ID + ': compaction locks');
            ctx.slots.inject(SLOT_REVIEW_ACTIONS, () => ctx.slots.register({
                name: SLOT_REVIEW_ACTIONS,
                id: BUNDLE_ID,
                // Before the official "full plan" link, whatever order the two plugins load in.
                order: -1,
                locale: NS,
                inject: (sessionId) => ({
                    compactThenApprove: (request) => {
                        void compactThenApprove({ ...request, sessionId });
                    },
                }),
            }, PlanCompactAction));
            ctx.slots.inject(SLOT_COMPOSER, () => ctx.slots.register({
                name: SLOT_COMPOSER,
                // Tried before the official entries: the lock's interaction is the
                // only one this selector claims, and every other carrier declines.
                priority: -1,
                select: ({ pendingInteraction }) => pendingInteraction !== undefined && pendingInteraction.kind === LOCK_KIND ? pendingInteraction : null,
                locale: NS,
            }, PlanCompactProgress));
        }
        // ── Remote contribution ─────────────────────────────────────────────────
        // Client-side codecs only satisfy the boundary checks; strict validation is
        // the host manifest's job. Both codec generations are carried at once.
        const identity = (value) => value;
        const strictSchema = { parse: identity };
        const clientCodec = (typeSymbol) => ({
            mode: 'strict',
            typeSymbol,
            schema: strictSchema,
            create: () => strictSchema,
        });
        const CONTRIBUTION = {
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
        };
        bundleModule.exports.apply = apply;
        bundleModule.exports.inject = inject;
        return bundleModule.exports;
    },
});
