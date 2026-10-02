/**
 * Behavior guard for the plan-review decision control.
 *
 * Runs the shipped browser bundle the way the host does, then drives the entry
 * it contributes to the official `conversation.plan-review.actions` list: the
 * compaction round trip, the answer that runs the plan afterwards, and the lock
 * that keeps the official decisions out of reach while the host rewrites the
 * history. The progress card the lock publishes into the composer chain is
 * driven here too, because it is what the user sees instead of the official
 * card for the duration.
 */
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  loadBundle, loadBundleAt, createReactStub, createCtxStub, composeInjectProps, composeStandardProps,
  flush, elements, stringsIn, NAMESPACE, BUNDLE_ID,
} from "./bundle.mjs";

let failures = 0;
const check = async (label, fn) => {
  try {
    await fn();
    console.log("PASS  " + label);
  } catch (error) {
    failures += 1;
    console.log("FAIL  " + label + "\n      " + (error && error.message ? error.message : error));
  }
};

/** Milliseconds the lock outlives a landed answer, plus one scheduling turn. */
const SETTLE_GRACE_MS = 450;

/** The narrowed review the official panel hands to every entry of its strip slot. */
const REVIEW = {
  id: "plan-review",
  question: "Approve this plan and leave plan mode?",
  plan: "# Refactor the parser\n\nMove the range rule out of the loop.",
  callId: "call-1",
  approve: { label: "Approve", description: "Leave plan mode; the plan is carried out from the next step." },
  decline: { label: "Keep planning" },
};

/**
 * One live carrier, in the shape the official questions plugin publishes.
 *
 * @param options - `sessionId`/`requestKey`: review identity; `verbs`: which
 * optional 0.2.0 verbs it exposes; `dismissFailure`/`answerFailure`: the message
 * that verb rejects with.
 * @returns the carrier, its recorded answers, and its recorded verb calls.
 */
function carrier(options = {}) {
  const answered = [];
  const calls = [];
  const pending = {
    sessionId: options.sessionId ?? "session-1",
    kind: "plan-review",
    key: options.requestKey ?? "plan-review:1",
    questions: [{ id: REVIEW.id }],
    answer: async (answer) => {
      calls.push("answer");
      if (options.answerFailure !== undefined) throw options.answerFailure;
      answered.push(answer);
    },
  };
  if ((options.verbs ?? []).includes("dismiss")) {
    pending.dismiss = async () => {
      calls.push("dismiss");
      if (options.dismissFailure !== undefined) throw options.dismissFailure ?? new Error("unreachable");
    };
  }
  if ((options.verbs ?? []).includes("snapshot")) {
    pending.snapshot = () => ({ channel: options.channel ?? "rpc" });
  }
  return { pending, answered, calls, sessionId: pending.sessionId, requestKey: pending.key };
}

/** Cross-realm values carry the vm's prototypes, so compare their JSON projection. */
const plain = (value) => JSON.parse(JSON.stringify(value));

// ── Registration shape, decision behaviour, and the lock ────────────────────
{
  const react = createReactStub();
  const bundle = loadBundle({ react: react.React });
  const remoteCalls = [];
  const remote = {
    compactBeforeExecute: (sessionId) => {
      const deferred = Promise.withResolvers();
      remoteCalls.push({ sessionId, deferred });
      return deferred.promise;
    },
  };
  const { ctx, state } = createCtxStub({ remote, inject: [...bundle.module.inject] });

  await check("bundle exports apply/inject for the seed-module contract", async () => {
    assert.equal(typeof bundle.module.apply, "function");
    // `uiSession` is declared, not looked up: the client runner makes a service
    // visible to a plugin only when the plugin injects it, so an undeclared
    // `ctx.get('uiSession')` resolves to undefined (as the installed official
    // conversation plugin also declares it).
    assert.deepEqual([...bundle.module.inject], ["slots", "locale", "remote", "uiSession"]);
    assert.equal(bundle.styleTags.length, 1, "the stylesheet must be injected inside the factory");
  });

  await bundle.module.apply(ctx);

  const actionEntry = state.registrations.find((row) => row.registration.name === "conversation.plan-review.actions");
  const composerEntry = state.registrations.find((row) => row.registration.name === "conversation.composer");

  await check("dictionaries cover both shipped locales with one key set", async () => {
    const dicts = state.dictionaries.get(NAMESPACE);
    assert.ok(dicts, "the planCompact namespace was never registered");
    assert.deepEqual(Object.keys(dicts.zh).sort(), Object.keys(dicts.en).sort());
    assert.equal(dicts.zh.compactExecute, "压缩后执行");
    assert.equal(dicts.zh.compacting, "压缩中…");
    assert.equal(dicts.zh.progressCompacting, "正在压缩上下文");
    assert.equal(dicts.zh.compactionFailedPrefix, "压缩失败：");
    assert.equal(dicts.zh.answerFailedPrefix, "未能执行计划：");
    assert.equal(dicts.en.compactExecute, "Compact and run");
  });

  await check("the decision joins the official strip slot and declares nothing", async () => {
    assert.ok(actionEntry, "the plugin must contribute to conversation.plan-review.actions");
    const { registration } = actionEntry;
    assert.equal(registration.id, BUNDLE_ID, "a list entry is addressed by its id");
    assert.equal(registration.order, -1, "the decision renders before the official full-plan link");
    assert.equal(registration.locale, NAMESPACE);
    assert.equal(typeof registration.inject, "function");
    assert.equal(
      registration.children,
      undefined,
      "the official entry owns conversation.plan-review.actions, and a second declaration of it fails the whole client boot",
    );
  });

  await check("the composer entry elects the compaction lock only", async () => {
    assert.ok(composerEntry, "the lock needs a composer entry to present its progress card");
    const { registration } = composerEntry;
    assert.equal(registration.priority, -1, "the lock must be tried before the official entries");
    assert.equal(registration.children, undefined, "the official composer entry declares conversation.plan-review.actions");
    assert.equal(typeof registration.select, "function");
    const lock = { key: "plan-review:1", kind: "plan-compact", sessionId: "session-1" };
    assert.equal(registration.select({ pendingInteraction: lock }), lock);
    assert.equal(registration.select({ pendingInteraction: undefined }), null);
    assert.equal(registration.select({ pendingInteraction: { kind: "plan-review", key: "plan-review:1", sessionId: "s" } }), null);
    assert.equal(registration.select({ pendingInteraction: { kind: "question", key: "q:1", sessionId: "s" } }), null);
  });

  // ── Render drivers ────────────────────────────────────────────────────────
  const action = actionEntry.component;
  const progress = composerEntry.component;
  const actionFace = (sessionId) => actionEntry.registration.inject(sessionId);
  let tree = null;
  let props = null;
  const renderAction = (fixture) => {
    react.reset();
    props = {
      review: REVIEW,
      requestKey: fixture.requestKey,
      t: ctx.locale.bind(NAMESPACE),
      ...composeStandardProps({
        sessionId: fixture.sessionId,
        registry: state.pending,
        contextPressure: fixture.contextPressure,
      }),
      ...composeInjectProps(actionFace(fixture.sessionId)),
    };
    react.beginRender();
    tree = action(props);
    react.flushEffects();
    return tree;
  };
  const renderProgress = (sessionId) => {
    react.reset();
    props = {
      matched: { key: "plan-review:lock", kind: "plan-compact", sessionId },
      t: ctx.locale.bind(NAMESPACE),
      ...composeStandardProps({ sessionId, registry: state.pending }),
    };
    react.beginRender();
    tree = progress(props);
    react.flushEffects();
    return tree;
  };
  react.setRender(() => {
    react.beginRender();
    tree = action(props);
    react.flushEffects();
  });

  const buttons = () => elements(tree).filter((element) => element.type === "button");
  const control = () => buttons()[0];
  const label = () => control().children[0];
  const failure = () => elements(tree).find((element) => element.props?.className === "PCE_failure");
  /**
   * One review of its own Session, published by an official domain the way
   * `dsh-client-ui-user-questions` publishes its carriers.
   * @param options - carrier options.
   * @returns the fixture, with its identity and the official publication.
   */
  let fixtures = 0;
  const domainsBefore = state.pending.domains.length;
  const fixture = (options = {}) => {
    fixtures += 1;
    const row = carrier({ ...options, sessionId: "session-" + fixtures, requestKey: "plan-review:" + fixtures });
    const unpublish = state.pending.registerPendingInteraction(
      (value) => (value.kind === "plan-review" ? 2 : 1),
    )(row.pending, async () => {});
    return { ...row, unpublish };
  };

  const first = fixture({ verbs: ["dismiss", "snapshot"] });
  renderAction(first);

  await check("the decision renders beside the official controls", async () => {
    assert.equal(buttons().length, 1, "the control contributes exactly one button");
    assert.equal(label(), "压缩后执行");
    assert.equal(control().props.title, "把计划提交前的历史压缩成摘要，然后立即执行计划");
    assert.equal(control().props.disabled, false);
    assert.equal(failure(), undefined);
  });

  await check("deciding compacts the session before answering the review", async () => {
    control().props.onClick();
    assert.equal(remoteCalls.length, 1);
    assert.equal(remoteCalls[0].sessionId, first.sessionId);
    assert.equal(first.answered.length, 0, "approval must wait for the compaction");
    renderAction(first);
    assert.equal(label(), "压缩中…");
    assert.equal(control().props.disabled, true, "a running compaction locks its own row");

    remoteCalls[0].deferred.resolve({ ok: true, value: { outcome: "compacted", shadowedNodes: 12, shadowedTokens: 4300 } });
    await flush();
    assert.deepEqual(plain(first.answered), [{ answers: [{ id: "plan-review", selected: ["Approve"] }] }]);
    assert.deepEqual(first.calls, ["answer", "dismiss"], "an RPC answer hides the panel exactly like the official one");
    renderAction(first);
    assert.equal(label(), "正在执行计划");
    assert.equal(control().props.disabled, true, "the lock outlives the answer until the card is retired");
  });

  await check("the compaction lock displaces the official carrier while it runs", async () => {
    const second = fixture({ verbs: ["dismiss", "snapshot"] });
    renderAction(second);
    assert.equal(state.pending.winner(second.sessionId), second.pending, "the official carrier owns the session first");

    control().props.onClick();
    const lock = state.pending.winner(second.sessionId);
    assert.equal(lock.kind, "plan-compact", "the lock must displace the official carrier");
    assert.equal(lock.key, second.requestKey);
    assert.equal(lock.sessionId, second.sessionId);
    assert.equal(
      state.pending.domains[0].entries.has(second.requestKey),
      true,
      "the lock is published into this plugin's own domain",
    );
    assert.equal(
      state.pending.domains.some((domain) => [...domain.entries.values()].some((record) => record.interaction === second.pending)),
      true,
      "the official carrier was never unpublished, so the official card returns by itself once the lock is released",
    );
    assert.equal(
      state.pending.domains.length,
      domainsBefore + fixtures,
      "holding the lock must not add a domain of its own",
    );

    // The progress card is what the composer shows while the lock holds the seat.
    const card = renderProgress(second.sessionId);
    assert.deepEqual(stringsIn(card), ["正在压缩上下文", "压缩完成后会立即执行计划。"]);
    assert.equal(elements(card).some((element) => element.props?.className === "PCE_frame"), true);

    remoteCalls.at(-1).deferred.resolve({ ok: true, value: { outcome: "nothing-to-compact", shadowedNodes: 0, shadowedTokens: 0 } });
    await flush();
    assert.deepEqual(plain(second.answered), [{ answers: [{ id: "plan-review", selected: ["Approve"] }] }], "nothing-to-compact still runs the plan");
    const applying = renderProgress(second.sessionId);
    assert.deepEqual(stringsIn(applying), ["正在执行计划"], "the card stops claiming to compact once the answer landed");

    await new Promise((resolve) => setTimeout(resolve, SETTLE_GRACE_MS));
    assert.equal(state.pending.winner(second.sessionId), second.pending, "once the answer landed, the official card owns the session again");
  });

  await check("a host failure keeps the review answerable and shows the diagnostic", async () => {
    const third = fixture({ verbs: ["dismiss", "snapshot"] });
    remoteCalls.length = 0;
    renderAction(third);
    control().props.onClick();
    assert.equal(state.pending.winner(third.sessionId)?.kind, "plan-compact");
    remoteCalls.at(-1).deferred.resolve({ ok: false, error: { code: "gateway/internal", message: "compaction already in progress" } });
    await flush();
    assert.equal(third.answered.length, 0, "a failed compaction must not run the plan");
    assert.equal(state.pending.winner(third.sessionId), third.pending, "a failed compaction hands the session back to the official card");
    renderAction(third);
    assert.equal(failure().children[0], "压缩失败：compaction already in progress");
    assert.equal(failure().props.title, "压缩失败：compaction already in progress");
    assert.equal(label(), "压缩后执行");
    assert.equal(control().props.disabled, false);
  });

  await check("a rejected remote call is reported the same way", async () => {
    const fourth = fixture({ verbs: ["dismiss", "snapshot"] });
    remoteCalls.length = 0;
    renderAction(fourth);
    control().props.onClick();
    remoteCalls.at(-1).deferred.reject(bundle.vmError("socket closed"));
    await flush();
    assert.equal(fourth.answered.length, 0);
    renderAction(fourth);
    assert.equal(failure().children[0], "压缩失败：socket closed");
    assert.equal(state.pending.winner(fourth.sessionId), fourth.pending, "the lock must be released on a rejection too");
  });

  await check("an ended review reports instead of calling the host", async () => {
    const before = remoteCalls.length;
    const gone = fixture();
    gone.unpublish();
    renderAction(gone);
    assert.equal(state.pending.winner(gone.sessionId), undefined);
    control().props.onClick();
    await flush();
    assert.equal(remoteCalls.length, before, "a review that already left must not compact anything");
    renderAction(gone);
    assert.equal(failure().children[0], "这条计划审阅已经结束。");
  });

  await check("a 0.1.7 carrier answers without the 0.2.0 verbs", async () => {
    const legacy = fixture({ verbs: [] });
    remoteCalls.length = 0;
    renderAction(legacy);
    control().props.onClick();
    remoteCalls.at(-1).deferred.resolve({ ok: true, value: { outcome: "compacted", shadowedNodes: 3, shadowedTokens: 900 } });
    await flush();
    assert.deepEqual(plain(legacy.answered), [{ answers: [{ id: "plan-review", selected: ["Approve"] }] }]);
    assert.deepEqual(legacy.calls, ["answer"], "a carrier without dismiss()/snapshot() needs neither");
  });

  await check("a panel that refuses to close is reported without claiming the compaction failed", async () => {
    const stubborn = fixture({ verbs: ["dismiss", "snapshot"], dismissFailure: bundle.vmError("panel is stuck") });
    remoteCalls.length = 0;
    renderAction(stubborn);
    control().props.onClick();
    remoteCalls.at(-1).deferred.resolve({ ok: true, value: { outcome: "compacted", shadowedNodes: 1, shadowedTokens: 500 } });
    await flush();
    assert.deepEqual(plain(stubborn.answered), [{ answers: [{ id: "plan-review", selected: ["Approve"] }] }], "the answer landed");
    renderAction(stubborn);
    assert.equal(failure().children[0], "回答已发送；面板未能关闭。");
    assert.equal(state.pending.winner(stubborn.sessionId), stubborn.pending, "the official card stays reachable");
  });

  await check("an answer that can no longer land says so instead of blaming the compaction", async () => {
    const settled = fixture({ verbs: ["dismiss", "snapshot"], answerFailure: bundle.vmError("pending question is already settled") });
    remoteCalls.length = 0;
    renderAction(settled);
    control().props.onClick();
    remoteCalls.at(-1).deferred.resolve({ ok: true, value: { outcome: "compacted", shadowedNodes: 4, shadowedTokens: 1200 } });
    await flush();
    assert.deepEqual(plain(settled.answered), [], "a rejected answer must not be recorded as one");
    renderAction(settled);
    assert.equal(failure().children[0], "未能执行计划：pending question is already settled");
    assert.equal(state.pending.winner(settled.sessionId), settled.pending, "the review stays decidable by the official buttons");
  });

  await check("a second click cannot start a second compaction", async () => {
    const fifth = fixture({ verbs: ["dismiss", "snapshot"] });
    remoteCalls.length = 0;
    renderAction(fifth);
    control().props.onClick();
    control().props.onClick();
    assert.equal(remoteCalls.length, 1, "the lock makes the decision idempotent");
    remoteCalls.at(-1).deferred.resolve({ ok: true, value: { outcome: "compacted", shadowedNodes: 1, shadowedTokens: 400 } });
    await flush();
    assert.equal(fifth.answered.length, 1);
  });

  await check("the progress card renders nothing without a lock of its own session", async () => {
    assert.equal(renderProgress("another-session"), null);
  });

  // ── The occupancy ring ────────────────────────────────────────────────────
  // The decision's icon carries the reading the official composer meter would
  // show, because this card displaces that composer. These checks drive the
  // shipped bundle with a `contextPressure` value and read the arc it draws.
  /**
   * The decision's leading icon node, materialized. The harness records elements
   * without rendering nested components, and this icon is the one component it
   * has to reach into; it keeps no hooks, so invoking it is the node React would
   * have produced.
   */
  const icon = () => {
    const node = control().props.icon;
    return typeof node?.type === "function" ? node.type(node.props) : node;
  };
  /** The occupancy ring, when the control drew one instead of the official mark. */
  const ring = () => (icon()?.props?.className === "PCE_ring" ? icon() : undefined);
  /** The arc circle: the ring's child the dash length identifies. */
  const arc = () => (ring()?.children ?? []).find((child) => child != null && child.props?.strokeDasharray !== undefined);
  /** The arc's share of one full turn, recomputed from the rendered circle's own radius. */
  const arcShare = () => {
    const [drawn] = String(arc().props.strokeDasharray).split(" ");
    return Number(drawn) / (2 * Math.PI * Number(arc().props.r));
  };

  await check("the ring draws the occupancy the official meter reads", async () => {
    const reading = fixture();
    renderAction({ ...reading, contextPressure: { projectedTokens: 84000, contextWindow: 200000 } });
    assert.ok(ring(), "a reported usage and capacity must replace the official compact mark");
    assert.ok(Math.abs(arcShare() - 0.42) < 1e-9, `the arc must be 42% of the ring, got ${arcShare()}`);
    assert.equal(control().props.title, "把计划提交前的历史压缩成摘要，然后立即执行计划（上下文已用 42%）");
    assert.equal(label(), "压缩后执行", "the ring must not change the decision's own label");
    assert.equal(buttons().length, 1, "the ring stays inside the existing decision button");
  });

  await check("the reading prefers the value a compaction has already moved", async () => {
    const reading = fixture();
    renderAction({
      ...reading,
      contextPressure: { pressureTokens: 10000, projectedTokens: 84000, contextWindow: 200000 },
    });
    assert.ok(
      Math.abs(arcShare() - 0.42) < 1e-9,
      "projectedTokens describes the next request, so it must win over the sampled pressure",
    );
  });

  await check("the reading never claims more than a full window", async () => {
    const reading = fixture();
    renderAction({ ...reading, contextPressure: { projectedTokens: 400000, contextWindow: 200000 } });
    assert.ok(Math.abs(arcShare() - 1) < 1e-9, `a full window must fill the ring, got ${arcShare()}`);
    assert.equal(control().props.title, "把计划提交前的历史压缩成摘要，然后立即执行计划（上下文已用 100%）");
  });

  await check("without a reading the official mark and the plain hint stay", async () => {
    for (const contextPressure of [undefined, { pressureTokens: 84000 }, { contextWindow: 200000 }]) {
      const reading = fixture();
      renderAction({ ...reading, contextPressure });
      assert.equal(ring(), undefined, "usage without a capacity is not a reading");
      assert.equal(control().props.title, "把计划提交前的历史压缩成摘要，然后立即执行计划");
      assert.equal(label(), "压缩后执行");
    }
  });

  await check("a measured zero draws the track alone", async () => {
    const reading = fixture();
    renderAction({ ...reading, contextPressure: { projectedTokens: 0, contextWindow: 200000 } });
    assert.ok(ring(), "a reported zero is still a reading");
    assert.equal(arc(), undefined, "a zero-length arc with round caps would draw a dot");
    assert.equal(control().props.title, "把计划提交前的历史压缩成摘要，然后立即执行计划（上下文已用 0%）");
  });

  await check("the reading stays on screen while the compaction runs", async () => {
    const reading = fixture({ verbs: ["dismiss", "snapshot"] });
    const contextPressure = { projectedTokens: 84000, contextWindow: 200000 };
    remoteCalls.length = 0;
    renderAction({ ...reading, contextPressure });
    control().props.onClick();
    renderAction({ ...reading, contextPressure });
    assert.equal(label(), "压缩中…");
    assert.ok(ring(), "the ring is the only occupancy left once the official composer is displaced");
    assert.equal(control().props.title, "把计划提交前的历史压缩成摘要，然后立即执行计划（上下文已用 42%）");
    remoteCalls.at(-1).deferred.resolve({ ok: true, value: { outcome: "compacted", shadowedNodes: 1, shadowedTokens: 400 } });
    await flush();
  });
}

// ── Absent or broken host half, and a composition without the lock registry ──
{
  await check("without the remote namespace the official card stays in charge", async () => {
    const react = createReactStub();
    const bundle = loadBundle({ react: react.React });
    const { ctx, state } = createCtxStub({ remote: undefined });
    await bundle.module.apply(ctx);
    assert.equal(state.registrations.length, 0);
    assert.equal(state.dictionaries.size, 1, "dictionaries still register for a late host half");
  });

  await check("a failed contribution mount leaves the official card in place", async () => {
    const react = createReactStub();
    const bundle = loadBundle({ react: react.React });
    const { ctx, state } = createCtxStub({
      remote: { compactBeforeExecute: async () => ({ ok: true, value: { outcome: "compacted", shadowedNodes: 0, shadowedTokens: 0 } }) },
      mountFailure: new Error("no gateway"),
    });
    await bundle.module.apply(ctx);
    assert.equal(state.registrations.length, 0);
    assert.equal(bundle.warnings.length, 1);
  });

}

// ── A host call that never settles must not keep the review locked ──────────
{
  // The lock suppresses every official card of its Session, so a lost answer — a
  // gateway that went away mid-compaction is the real case — would otherwise leave
  // the user with no card at all: no review, and no later question either. The
  // shipped deadline is minutes long, so this check drives the same artifact with
  // the deadline rewritten to milliseconds.
  const react = createReactStub();
  const source = readFileSync(fileURLToPath(new URL("../lib/client.js", import.meta.url)), "utf8");
  const patched = source.replace(/COMPACTION_DEADLINE_MS = [^;]+;/, "COMPACTION_DEADLINE_MS = 40;");
  assert.ok(
    patched.includes("COMPACTION_DEADLINE_MS = 40;"),
    "the shipped bundle no longer declares a deadline constant this check can drive",
  );
  const file = join(mkdtempSync(join(tmpdir(), "plan-compact-deadline-")), "client.js");
  writeFileSync(file, patched);

  const bundle = loadBundleAt(file, { react: react.React });
  const calls = [];
  const remote = {
    compactBeforeExecute: (sessionId) => {
      const deferred = Promise.withResolvers();
      calls.push({ sessionId, deferred });
      return deferred.promise;
    },
  };
  const { ctx, state } = createCtxStub({ remote, inject: [...bundle.module.inject] });
  await bundle.module.apply(ctx);
  const entry = state.registrations.find((row) => row.registration.name === "conversation.plan-review.actions");
  const review = carrier({ sessionId: "session-lost", requestKey: "plan-review:lost", verbs: ["dismiss", "snapshot"] });
  state.pending.registerPendingInteraction(() => 2)(review.pending, async () => {});
  const props = {
    review: REVIEW,
    requestKey: review.requestKey,
    t: ctx.locale.bind(NAMESPACE),
    ...composeStandardProps({ sessionId: review.sessionId, registry: state.pending }),
    ...composeInjectProps(entry.registration.inject(review.sessionId)),
  };

  await check("a host call that never settles releases the lock and says so", async () => {
    react.beginRender();
    let tree = entry.component(props);
    react.flushEffects();
    elements(tree).find((element) => element.type === "button").props.onClick();
    assert.equal(calls.length, 1);
    assert.equal(state.pending.winner(review.sessionId).kind, "plan-compact", "the lock must be held while the call is awaited");

    await new Promise((resolve) => setTimeout(resolve, 90));
    assert.equal(
      state.pending.winner(review.sessionId),
      review.pending,
      "a host call that never settles must hand the Session back, or no official card can ever appear again",
    );
    react.reset();
    react.beginRender();
    tree = entry.component(props);
    react.flushEffects();
    assert.equal(
      elements(tree).find((element) => element.props?.className === "PCE_failure").children[0],
      "压缩超时，已解除锁定，可以重试。",
    );
    assert.deepEqual(plain(review.answered), [], "a timed-out compaction must not run the plan");
  });

  await check("a late host result after the deadline cannot run the plan", async () => {
    calls[0].deferred.resolve({ ok: true, value: { outcome: "compacted", shadowedNodes: 2, shadowedTokens: 700 } });
    await flush();
    assert.deepEqual(plain(review.answered), [], "the abandoned attempt must not answer the review afterwards");
    assert.equal(state.pending.winner(review.sessionId), review.pending);
  });
}

console.log(failures === 0 ? "\nall panel checks passed" : `\n${failures} panel check(s) failed`);
process.exit(failures === 0 ? 0 : 1);
