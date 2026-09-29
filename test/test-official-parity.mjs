/**
 * Follow-the-official-version gate for the plan-review strip.
 *
 * This plugin no longer replaces the official card: it contributes one entry to
 * the list slot the official composer entry declares, next to the "full plan"
 * link `@deepseek-ai/dsh-client-ui-plan` puts there. Coexistence is therefore the
 * whole contract, and every part of it can drift:
 *
 * - the slot is declared once per composition (by the official composer entry),
 *   so naming it in a `children` table again fails the whole client boot;
 * - the official strip hosts the slot, so a renamed container moves this control;
 * - the two other entries (the official preview link) must stay in the same list
 *   without cell-id collisions;
 * - this control answers through the carrier verbs the installed official panel
 *   uses, so a generation that renames one leaves this control calling a verb
 *   that no longer exists;
 * - the one message this plugin mirrors from the official panel (`status.sent`)
 *   must keep the official wording where the official generation ships one.
 *
 * The gate loads the INSTALLED bundles in the same vm harness as the shipped one
 * and reads the installed artifacts. A missing or unloadable official bundle
 * fails loudly, because a gate that cannot see the official implementation proves
 * nothing.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { loadBundleAt, loadBundle, createReactStub, createCtxStub } from "./bundle.mjs";

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

/** Official packages whose plan-review presentation this plugin joins. */
const OFFICIAL_PACKAGE = "@deepseek-ai/dsh-client-ui-user-questions";
const PLAN_PACKAGE = "@deepseek-ai/dsh-client-ui-plan";

/** The slot both other parties touch. */
const SLOT = "conversation.plan-review.actions";

/** Cross-realm values carry the vm's prototypes, so compare their JSON projection. */
const plain = (value) => JSON.parse(JSON.stringify(value));

/**
 * Read one official bundle, failing the gate when it is absent.
 * @param packageName - installed package whose browser bundle is read.
 * @returns the bundle source text and its absolute path.
 */
const readOfficial = (packageName) => {
  const path = fileURLToPath(new URL(`../node_modules/${packageName}/lib/client.js`, import.meta.url));
  try {
    return { source: readFileSync(path, "utf8"), path };
  } catch (error) {
    // A gate that cannot see the official implementation proves nothing, so a
    // missing devDependency is a failure rather than a skip.
    console.error(`FAIL  cannot read the official bundle at ${path} (${error && error.message ? error.message : error})`);
    console.error("      install this repository's devDependencies before running the parity gate");
    process.exit(1);
  }
};

// ── Load the installed official bundles ─────────────────────────────────────
const official = readOfficial(OFFICIAL_PACKAGE);
const plan = readOfficial(PLAN_PACKAGE);
// One hook runtime per bundle: the components close over the stub they were
// materialized with, so loading and rendering must share it.
const officialReact = createReactStub();
let officialVersion;
let officialBundle;
try {
  officialVersion = JSON.parse(readFileSync(fileURLToPath(new URL(`../node_modules/${OFFICIAL_PACKAGE}/package.json`, import.meta.url)), "utf8")).version;
  officialBundle = loadBundleAt(official.path, { react: officialReact.React });
} catch (error) {
  console.error(`FAIL  cannot load the official bundle at ${official.path} (${error && error.message ? error.message : error})`);
  console.error("      install this repository's devDependencies before running the parity gate");
  process.exit(1);
}

const officialCtx = createCtxStub();
await check("the installed official bundle loads and registers its composer entry", async () => {
  assert.equal(officialBundle.id, OFFICIAL_PACKAGE);
  await officialBundle.module.apply(officialCtx.ctx);
  const entries = officialCtx.state.registrations.filter((row) => row.registration.name === "conversation.composer");
  assert.equal(entries.length, 1, "expected exactly one official composer entry");
});
console.log(`official package under test: ${OFFICIAL_PACKAGE}@${officialVersion}`);

// ── Load the shipped bundle ─────────────────────────────────────────────────
const oursReact = createReactStub();
const ourBundle = loadBundle({ react: oursReact.React });
const ourCtx = createCtxStub({
  remote: { compactBeforeExecute: async () => ({ ok: true, value: { outcome: "compacted", shadowedNodes: 0, shadowedTokens: 0 } }) },
});
await ourBundle.module.apply(ourCtx.ctx);

const officialEntry = officialCtx.state.registrations.find((row) => row.registration.name === "conversation.composer");
const ourAction = ourCtx.state.registrations.find((row) => row.registration.name === SLOT);
const officialQuestion = officialCtx.state.dictionaries.get("question");
const ourDictionaries = ourCtx.state.dictionaries.get("planCompact");

await check("the official entry still declares the slot, and our entry never redeclares it", async () => {
  // A child key may be declared once per composition: the official entry always
  // declares this one, and this plugin's second declaration took the whole 0.2.0
  // client boot down (`slot "…" is already declared`).
  assert.deepEqual(
    plain(officialEntry.registration.children),
    { [SLOT]: { kind: "list", scope: "session" } },
    "the official child slot declaration changed; the list this control joins must be re-checked",
  );
  assert.equal(ourAction.registration.children, undefined, "our entry must not declare a child of conversation.composer");
});

await check("the official strip still hosts that slot", async () => {
  assert.ok(
    /previewActions,\s*children: renderSlot\(/.test(official.source),
    "the official panel no longer renders the strip slot container this control appears in",
  );
  assert.ok(official.source.includes("_css_default.previewActions"), "the official strip container class changed");
});

await check("the official preview link fills the same list under its own cell id", async () => {
  assert.ok(
    new RegExp(`name: "${SLOT}"`).test(plan.source),
    "the official plan package no longer contributes to the strip slot; the preview control moved",
  );
  const previewId = /const previewId = "([^"]+)"/.exec(plan.source);
  assert.notEqual(previewId, null, "the official preview entry's cell id changed shape");
  assert.notEqual(previewId[1], ourAction.registration.id, "two list entries must not share a cell id");
  assert.ok(
    /hooks: \{ sidebarMounted: ctx\.sidebarRight\.mounted \}/.test(plan.source),
    "the official preview control's automatic open changed; this plugin relies on the official control for it",
  );
});

/**
 * Read one CSS rule's declarations out of a bundle's injected stylesheet text.
 * Class names carry a per-build hash, so official rules match by suffix.
 *
 * @param source - bundle source.
 * @param className - exact class name (ours) or a suffix applied to any hash.
 * @returns the declaration list, or undefined when the rule is absent.
 */
const cssRule = (source, className) => {
  const exact = new RegExp(`\\.${className}\\{([^}]*)\\}`).exec(source);
  if (exact !== null) return exact[1];
  const hashed = new RegExp(`\\.[A-Za-z0-9_-]+_${className}\\{([^}]*)\\}`).exec(source);
  return hashed === null ? undefined : hashed[1];
};

await check("the decision separates itself from the official link it sits beside", async () => {
  // The official strip container lays its children out with no gap, and it is not
  // ours to restyle, so a control that adds no separation of its own ends up
  // flush against the official link.
  const container = cssRule(official.source, "previewActions");
  assert.notEqual(container, undefined, "the official strip container rule is gone");
  assert.ok(!/(^|;)\s*gap:/.test(container), "the official container now spaces its children; our own margin can go");
  const control = cssRule(readFileSync(fileURLToPath(new URL("../lib/client.js", import.meta.url)), "utf8"), "PCE_control");
  assert.notEqual(control, undefined, "our control's rule is gone");
  assert.ok(/(^|;)\s*margin-right:/.test(control), `the control must space itself from the official link beside it: ${control}`);
});

await check("the shared failure copy keeps the official wording", async () => {
  // `status.sent` is the official 0.2.0 copy for an answer that landed while the
  // panel refused to close — the one message this plugin mirrors.
  for (const [locale, ourKey] of [["zh", "statusSent"], ["en", "statusSent"]]) {
    const officialValue = new RegExp(`"status\\.sent":\\s*"([^"]*)"`).exec(official.source);
    if (officialValue !== null && locale === "zh") {
      assert.equal(ourDictionaries.zh[ourKey], officialValue[1], `zh copy drifted for status.sent → ${ourKey}`);
    }
    assert.equal(typeof ourDictionaries[locale][ourKey], "string", `the ${locale} copy for a stuck panel is missing`);
  }
  assert.ok(
    officialQuestion.zh["plan.header"] !== undefined,
    "the official plan-review copy disappeared; the official panel is no longer the one rendering it",
  );
  for (const key of ["header", "discuss", "approve"]) {
    assert.equal(
      ourDictionaries.zh[key],
      undefined,
      `the plugin no longer renders the official ${key} control, so it must not carry its copy`,
    );
  }
});

await check("the shipped bundle speaks the carrier verbs the installed generation offers", async () => {
  // A runtime check would need the official bundle to apply inside this harness
  // (0.2.0's client needs session and projection surfaces this gate does not
  // build), so the pin is artifact-level. This control runs one decision of its
  // own: it answers the review, and it hides the answered panel exactly when the
  // installed carrier reports that answers travel the Remote channel — 0.2.0
  // added `dismiss()` and `snapshot().channel` for that. Rejecting a review stays
  // the official panel's decision, so this bundle must never end one itself.
  const shipped = readFileSync(fileURLToPath(new URL("../lib/client.js", import.meta.url)), "utf8");
  assert.ok(/pending|answer/.test(official.source), "the official panel no longer answers a pending review");
  assert.ok(shipped.includes("answer"), "this control must answer the review through the carrier");
  if (/pending\.dismiss\(|dismiss\(\) \{/.test(official.source)) {
    assert.ok(shipped.includes("dismiss"), "the installed carrier hides an answered panel with dismiss(); this bundle must call it");
  }
  if (/snapshot\(\)\??\.channel/.test(official.source)) {
    assert.ok(shipped.includes("channel"), "the official panel reads the answering channel from snapshot(); this bundle must too");
  }
  assert.ok(
    !/pending\.cancel\(/.test(shipped) && !shipped.includes("rejectPending"),
    "rejecting a review belongs to the official panel; this control only answers it",
  );
});

console.log(failures === 0 ? "\nall official-parity checks passed" : `\n${failures} official-parity check(s) failed`);
process.exit(failures === 0 ? 0 : 1);
