/**
 * Follow-the-official-version gate for the compaction lock.
 *
 * Locking uses four facts owned by other packages, and each one is a drift risk:
 * the review carrier is read from the session status (the pending interaction the
 * domain registry elects), the election is won by the highest precedence, the
 * official composer entry declines any carrier that is not its own class — which
 * is what unmounts the official panel while this plugin's lock holds the seat —
 * and the official panel hands the strip slot exactly the owner props this
 * control consumes.
 *
 * None of those packages exports the pieces under test (they export `apply` and
 * `inject`), so this gate pins the installed artifacts: the precedence rule, the
 * status projection, the root hook that surfaces it as `useSessionStatus`, the
 * official selector, the official slot call, and this plugin's own precedence
 * relative to the official domains. `test-panel.mjs` then executes the same
 * mechanism against a faithful registry.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

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

/** Official packages whose mechanism the lock rides on. */
const SESSION_PACKAGE = "@deepseek-ai/dsh-client-ui-session";
const QUESTIONS_PACKAGE = "@deepseek-ai/dsh-client-ui-user-questions";

/**
 * Read one bundle, failing the whole gate when it is absent.
 * @param packageName - installed package whose browser bundle is read.
 * @returns the bundle source text.
 */
const readOfficial = (packageName) => {
  const path = fileURLToPath(new URL(`../node_modules/${packageName}/lib/client.js`, import.meta.url));
  try {
    return readFileSync(path, "utf8");
  } catch (error) {
    // A gate that cannot see the official implementation proves nothing, so a
    // missing devDependency is a failure rather than a skip.
    console.error(`FAIL  cannot read the official bundle at ${path} (${error && error.message ? error.message : error})`);
    console.error("      install this repository's devDependencies before running the lock gate");
    process.exit(1);
  }
};

const sessionBundle = readOfficial(SESSION_PACKAGE);
const questionsBundle = readOfficial(QUESTIONS_PACKAGE);
const ourBundle = readFileSync(fileURLToPath(new URL("../lib/client.js", import.meta.url)), "utf8");

console.log(`official packages under test: ${SESSION_PACKAGE}, ${QUESTIONS_PACKAGE}`);

/**
 * Read one numeric constant out of a bundle.
 * @param source - bundle source.
 * @param name - constant name as the emitter wrote it.
 * @returns the numeric value.
 */
const constantOf = (source, name) => {
  const match = new RegExp(`${name} = (\\d+)`).exec(source);
  assert.notEqual(match, null, `the bundle no longer declares ${name}`);
  return Number(match[1]);
};

check("the status projection still publishes the answering carrier", () => {
  assert.ok(
    sessionBundle.includes("pendingInteraction: this.pendingSnapshot.get("),
    "the session status no longer carries the pending interaction; the review carrier this control answers through would be unreachable",
  );
  assert.ok(
    sessionBundle.includes("sessionStatus: service.sessionStatus"),
    "ui-session no longer contributes its status as a root store hook; the composed `useSessionStatus` prop would disappear",
  );
  assert.ok(
    sessionBundle.includes("registerPendingInteraction(precedence)"),
    "the pending-interaction registry's precedence parameter changed",
  );
});

check("the election is still won by the highest precedence", () => {
  assert.ok(
    /precedence >= previous\.precedence/.test(sessionBundle),
    "the per-session election rule changed; displacing the official card by precedence is no longer the documented behaviour",
  );
});

check("the official composer declines any carrier that is not its own", () => {
  assert.ok(
    /pendingInteraction instanceof PendingQuestion \? pendingInteraction : null/.test(questionsBundle),
    "the official composer selector changed; a foreign interaction may no longer unmount the official plan-review panel",
  );
});

check("our lock outranks every official domain", () => {
  const officialPrecedence = /pending\.kind === "plan-review" \? (\d+) : (\d+)/.exec(questionsBundle);
  assert.notEqual(officialPrecedence, null, "the official domains' precedence expression changed");
  const planReview = Number(officialPrecedence[1]);
  const question = Number(officialPrecedence[2]);
  const ours = constantOf(ourBundle, "LOCK_PRECEDENCE");
  assert.ok(
    ours > planReview && ours > question,
    `our lock precedence (${ours}) must be above the official domains (plan review ${planReview}, question ${question})`,
  );
  assert.ok(ourBundle.includes("registerPendingInteraction"), "the lock no longer publishes through the pending-interaction registry");
});

check("the published lock carries the pending-interaction base identity", () => {
  assert.ok(
    /publish\(\{ key, kind: LOCK_KIND, sessionId \}/.test(ourBundle),
    "a published interaction must carry the registry's base identity (key, kind, sessionId)",
  );
  const kind = /LOCK_KIND = '([^']+)'/.exec(ourBundle);
  assert.notEqual(kind, null, "the shipped bundle no longer declares its lock kind");
  for (const official of ["approval", "plan-review", "question"]) {
    assert.notEqual(kind[1], official, `the lock must not impersonate the official ${official} kind`);
  }
});

check("the official panel hands its strip slot the props this control consumes", () => {
  assert.ok(
    /renderSlot\("conversation\.plan-review\.actions",\s*\{\s*review,\s*requestKey: pending\.key/.test(questionsBundle),
    "the official panel's owner props for conversation.plan-review.actions changed; this control's review/requestKey props come from there",
  );
});

check("the shipped control registers into that slot and renders nobody else's", () => {
  assert.ok(ourBundle.includes("conversation.plan-review.actions"), "the control no longer targets the official strip slot");
  assert.ok(!ourBundle.includes("renderSlot"), "an entry may only render the child slots it declares itself");
});

check("the lock outlives a landed answer long enough to cover the round trip", () => {
  const grace = constantOf(ourBundle, "SETTLE_GRACE_MS");
  assert.ok(grace > 0, "releasing the lock in the same turn as the answer flashes the official panel back");
  assert.ok(grace <= 2000, `a ${grace}ms grace would stall the composer after the answer landed`);
});

console.log(failures === 0 ? "\nall lock-protocol checks passed" : `\n${failures} lock-protocol check(s) failed`);
process.exit(failures === 0 ? 0 : 1);
