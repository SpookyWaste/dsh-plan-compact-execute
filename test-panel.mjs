/**
 * Behavior guard for the plan-review takeover.
 *
 * Runs the shipped browser bundle the way the host does, then drives the
 * registered composer component through its three decisions. The card replaces
 * the official plan-review presentation for `plan-review` carriers, so these
 * checks are what keeps "Request changes" and "Approve" compatible while
 * "Compact and run" adds the compaction round trip in front of approval.
 */
import assert from "node:assert/strict";
import { loadBundle, createReactStub, createCtxStub, flush, NAMESPACE } from "./test/bundle.mjs";

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

/** One plan-review carrier with recorded answers and cancellations. */
function carrier(overrides = {}) {
  const answered = [];
  const cancelled = [];
  const pending = {
    sessionId: "session-1",
    kind: "plan-review",
    key: "plan-review:1",
    questions: [
      {
        id: "plan-review",
        question: "Approve this plan and leave plan mode?",
        detail: "# Refactor the parser\n\nMove the range rule out of the loop.\n\nSecond paragraph.",
        options: [
          { label: "Approve", description: "Leave plan mode; the plan is carried out from the next step." },
          { label: "Keep planning", description: "Stay in plan mode; feedback goes back to the model." },
        ],
        intent: { kind: "plan-review", approve: "Approve", callId: "call-1" },
      },
    ],
    answer: async (answer) => {
      answered.push(answer);
    },
    cancel: async () => {
      cancelled.push(true);
    },
  };
  Object.assign(pending, overrides);
  return { pending, answered, cancelled };
}

/** Breadth-first collect of every element in a rendered tree. */
function elements(node) {
  const out = [];
  const visit = (value) => {
    if (value === null || value === undefined || typeof value !== "object") return;
    if (Array.isArray(value)) {
      value.forEach(visit);
      return;
    }
    out.push(value);
    for (const child of value.children ?? []) visit(child);
  };
  visit(node);
  return out;
}

/** Every string rendered anywhere in a tree. */
function stringsIn(node) {
  const out = [];
  const visit = (value) => {
    if (typeof value === "string") {
      out.push(value);
      return;
    }
    if (value === null || value === undefined || typeof value !== "object") return;
    if (Array.isArray(value)) {
      value.forEach(visit);
      return;
    }
    for (const child of value.children ?? []) visit(child);
  };
  visit(node);
  return out;
}

/** Cross-realm values carry the vm's prototypes, so compare their JSON projection. */
const plain = (value) => JSON.parse(JSON.stringify(value));

// ── Registration shape and panel behavior ───────────────────────────────────
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
  const { ctx, state } = createCtxStub({ remote });

  await check("bundle exports apply/inject for the seed-module contract", async () => {
    assert.equal(typeof bundle.module.apply, "function");
    assert.deepEqual([...bundle.module.inject], ["slots", "locale", "remote"]);
    assert.equal(bundle.styleTags.length, 1, "the stylesheet must be injected inside the factory");
  });

  await bundle.module.apply(ctx);

  const entries = state.registrations.filter((row) => row.registration.name === "conversation.composer");

  await check("dictionaries cover both shipped locales with one key set", async () => {
    const dicts = state.dictionaries.get(NAMESPACE);
    assert.ok(dicts, "the planCompact namespace was never registered");
    assert.deepEqual(Object.keys(dicts.zh).sort(), Object.keys(dicts.en).sort());
    assert.equal(dicts.zh.header, "计划待审");
    assert.equal(dicts.zh.approve, "同意执行");
    assert.equal(dicts.zh.discuss, "要求修改");
    assert.equal(dicts.zh.compactExecute, "压缩后执行");
    assert.equal(dicts.zh.compacting, "压缩中…");
    assert.equal(dicts.en.compactExecute, "Compact and run");
  });

  await check("exactly one composer entry is registered, ahead of the official one", async () => {
    assert.equal(entries.length, 1);
    const { registration } = entries[0];
    assert.equal(registration.priority, -1);
    assert.equal(registration.locale, NAMESPACE);
    assert.deepEqual(Object.keys(registration.children), ["conversation.plan-review.actions"]);
    assert.equal(typeof registration.select, "function");
    assert.equal(typeof registration.inject, "function");
  });

  const select = entries[0].registration.select;

  await check("the selector elects plan-review carriers only", async () => {
    const review = carrier();
    assert.equal(select({ pendingInteraction: review.pending }), review.pending);
    assert.equal(select({ pendingInteraction: undefined }), null);
    assert.equal(select({ pendingInteraction: { kind: "question", key: "question:1", sessionId: "s" } }), null);
    const broken = carrier({
      questions: [
        {
          id: "plan-review",
          detail: "# Plan",
          options: [{ label: "Other" }],
          intent: { kind: "plan-review", approve: "Approve" },
        },
      ],
    });
    assert.equal(select({ pendingInteraction: broken.pending }), null, "a review whose approve label names no option must fall back");
  });

  // ── Render driver ─────────────────────────────────────────────────────────
  const component = entries[0].component;
  const renderSlotCalls = [];
  let currentProps = null;
  let tree = null;
  const render = (pending) => {
    react.reset();
    currentProps = {
      matched: pending,
      sessionId: String(pending.sessionId),
      t: ctx.locale.bind(NAMESPACE),
      compactBeforeExecute: (sessionId) => remote.compactBeforeExecute(sessionId),
      renderSlot: (key, owner) => {
        renderSlotCalls.push({ key, owner });
        return null;
      },
    };
    react.beginRender();
    tree = component(currentProps);
    return tree;
  };
  react.setRender(() => {
    react.beginRender();
    tree = component(currentProps);
  });
  const buttons = () => elements(tree).filter((element) => element.type === "button");
  const labels = () => buttons().map((candidate) => candidate.children[0]);
  const disabled = () => buttons().map((candidate) => candidate.props.disabled);
  const button = (label) => buttons().find((candidate) => candidate.children.includes(label));
  const feedback = () => elements(tree).find((element) => element.props?.role === "status");

  const first = carrier();
  render(first.pending);

  await check("the card renders three decisions in the official action-row order", async () => {
    assert.deepEqual(labels(), ["要求修改", "压缩后执行", "同意执行"]);
    assert.equal(button("压缩后执行").props.title, "把计划提交前的历史压缩成摘要，然后立即执行计划");
    assert.equal(button("同意执行").props.title, "Leave plan mode; the plan is carried out from the next step.");
    assert.deepEqual(disabled(), [false, false, false]);
  });

  await check("the card keeps the official header, summary, and preview slot", async () => {
    const card = elements(tree).find((element) => element.type === "section");
    assert.equal(card.props["aria-label"], "Approve this plan and leave plan mode?");
    assert.equal(card.props["aria-busy"], false);
    const texts = stringsIn(tree);
    assert.ok(texts.includes("计划待审"), "the header copy is missing");
    assert.ok(texts.includes("Refactor the parser"), "the plan title is missing");
    assert.ok(texts.includes("Move the range rule out of the loop."), "the plan description is missing");
    const slot = renderSlotCalls.at(-1);
    assert.equal(slot.key, "conversation.plan-review.actions");
    assert.equal(slot.owner.requestKey, "plan-review:1");
    assert.equal(slot.owner.review.approve.label, "Approve");
  });

  await check("Request changes cancels the pending review", async () => {
    button("要求修改").props.onClick();
    await flush();
    assert.equal(first.cancelled.length, 1);
    assert.equal(first.answered.length, 0);
  });

  await check("Approve answers with the asker's own approve label", async () => {
    button("同意执行").props.onClick();
    await flush();
    assert.deepEqual(plain(first.answered), [{ answers: [{ id: "plan-review", selected: ["Approve"] }] }]);
  });

  await check("Compact and run compacts the session, then approves with the same label", async () => {
    const second = carrier();
    render(second.pending);
    button("压缩后执行").props.onClick();
    assert.equal(remoteCalls.length, 1);
    assert.equal(remoteCalls[0].sessionId, "session-1");
    assert.equal(second.answered.length, 0, "approval must wait for the compaction");
    assert.deepEqual(labels(), ["要求修改", "压缩中…", "同意执行"]);
    assert.deepEqual(disabled(), [true, true, true]);

    remoteCalls[0].deferred.resolve({ ok: true, value: { outcome: "compacted", shadowedNodes: 12, shadowedTokens: 4300 } });
    await flush();
    assert.deepEqual(plain(second.answered), [{ answers: [{ id: "plan-review", selected: ["Approve"] }] }]);
  });

  await check("nothing-to-compact still approves the plan", async () => {
    const third = carrier();
    render(third.pending);
    button("压缩后执行").props.onClick();
    remoteCalls.at(-1).deferred.resolve({ ok: true, value: { outcome: "nothing-to-compact", shadowedNodes: 0, shadowedTokens: 0 } });
    await flush();
    assert.deepEqual(plain(third.answered), [{ answers: [{ id: "plan-review", selected: ["Approve"] }] }]);
  });

  await check("a host failure keeps the review pending and shows the diagnostic", async () => {
    const fourth = carrier();
    render(fourth.pending);
    button("压缩后执行").props.onClick();
    remoteCalls.at(-1).deferred.resolve({ ok: false, error: { code: "gateway/internal", message: "compaction already in progress" } });
    await flush();
    assert.equal(fourth.answered.length, 0, "a failed compaction must not approve the plan");
    assert.equal(feedback().children[0], "压缩失败：compaction already in progress");
    assert.deepEqual(labels(), ["要求修改", "压缩后执行", "同意执行"]);
    assert.deepEqual(disabled(), [false, false, false]);
  });

  await check("a rejected remote call is reported the same way", async () => {
    const fifth = carrier();
    render(fifth.pending);
    button("压缩后执行").props.onClick();
    remoteCalls.at(-1).deferred.reject(bundle.vmError("socket closed"));
    await flush();
    assert.equal(fifth.answered.length, 0);
    assert.equal(feedback().children[0], "压缩失败：socket closed");
  });
}

// ── Absent or broken host half ──────────────────────────────────────────────
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

console.log(failures === 0 ? "\nall panel checks passed" : `\n${failures} panel check(s) failed`);
process.exit(failures === 0 ? 0 : 1);