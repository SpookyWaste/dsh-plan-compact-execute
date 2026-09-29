/**
 * Integration guard for the host half inside a real Cordis application.
 *
 * The plugin is mounted exactly as the loader mounts it (`ctx.plugin(module,
 * config)`), so this test covers the pieces the browser-half tests cannot: the
 * `Config` schema, the injected service names, the Typert manifest registration,
 * the remote service's resolution through the context proxy, and the arguments
 * the gateway hands to the compaction seam. The capability services themselves
 * are fakes, because the real ones need a durable session and a model call.
 *
 * The fixtures mirror the Web app's realm layout: `compaction-basic` is disabled
 * on the host plane and mounted behind each agent preset's
 * `isolate: { compaction: true }` realm, so the engine is reachable only through
 * `ctx.agentPresets.serviceFor(agent, 'compaction')`. Deployments without preset
 * realms compose it into the agent scope or onto the host plane instead, and both
 * stay in the resolve chain.
 */
import assert from "node:assert/strict";
import { Context } from "@deepseek-ai/cordis";
import * as host from "../lib/index.js";
import { METHOD_NAME, PACKAGE_NAME } from "../lib/protocol.js";
import { node, session } from "./session.mjs";

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

/** The pending-batch surface every span assertion below uses. */
const pendingHistory = () =>
  session([
    node(1, "system/message"),
    node(2, "user/message"),
    node(3, "assistant/message", 1),
    node(4, "tool/result"),
    node(5, "user/message"),
    node(6, "assistant/message", 1),
  ]);

/**
 * Mount the host plugin on a real Cordis root with fake capability services.
 * @param options - fixture and realm layout: which scope mounts compaction.
 * @returns the app, recorded calls, and the live service.
 */
async function mountHost(options = {}) {
  const app = new Context();
  const base = options.surface ?? pendingHistory();
  const live = options.live === false ? { ...base, live: false } : { ...base, live: true };
  const calls = { compactRegion: [], manifest: undefined, via: [] };
  const compactionResult = {
    compactionId: "c1",
    startSeq: 1,
    summarySeq: 2,
    endSeq: 3,
    summary: [],
    shadowedRange: { start: 0, end: 0 },
    shadowedSeqs: live.session.surface.nodes.slice(1, -1),
    shadowedTokenCount: 1234,
  };
  const face = (label) => ({
    compactRegion: async (start, end, owner, signal) => {
      calls.compactRegion.push({ start, end, owner, signal });
      calls.via.push(label);
      if (options.compactionFails === true) throw new Error("compaction already in progress");
      return compactionResult;
    },
  });

  const agentScope = {
    get: (name) => (name === "compaction" && options.agentCompaction === true ? face("agent-scope") : undefined),
  };
  const agent = { id: "session-1", session: live.session, options: {}, ctx: agentScope };

  app.provide("agents", { get: (id) => (id === "session-1" && live.live ? agent : undefined) });
  app.provide("tokenMeter", { measure: () => live.measurement });
  app.provide("typert", {
    register: (contribution) => {
      calls.manifest = contribution;
      return () => {};
    },
  });
  if (options.presetRegistry !== false) {
    app.provide("agentPresets", {
      serviceFor: (target, name) => (options.presetCompaction === true && name === "compaction" ? face("preset") : undefined),
    });
  }
  if (options.rootCompaction === true) app.provide("compaction", face("root"));

  await app.plugin(host, { minShadowedTokens: options.minShadowedTokens ?? 10 });
  return { app, calls, gateway: app.get("planCompactExec") };
}

await check("the plugin mounts with the manifest's injected services", async () => {
  assert.equal(host.name, "plan-compact-execute");
  assert.deepEqual([...host.inject], ["typert", "agents", "tokenMeter"]);
  assert.equal(host.inject.includes("compaction"), false, "a root-level compaction inject would stay pending in the Web app");
  const { calls } = await mountHost({ presetCompaction: true });
  assert.equal(calls.manifest.package, PACKAGE_NAME);
  assert.equal(calls.manifest.invocations.length, 1);
});

await check("the remote service is resolvable under the manifest's service key", async () => {
  const { gateway } = await mountHost({ presetCompaction: true });
  assert.equal(typeof gateway[METHOD_NAME], "function");
});

await check("the pre-plan span is handed to the compaction seam and reported back", async () => {
  const { calls, gateway } = await mountHost({ presetCompaction: true });
  const result = await gateway[METHOD_NAME]("session-1");
  assert.equal(calls.compactRegion.length, 1);
  assert.equal(calls.compactRegion[0].start, 2);
  assert.equal(calls.compactRegion[0].end, 5);
  assert.deepEqual({ ...result }, { outcome: "compacted", shadowedNodes: 4, shadowedTokens: 1234 });
});

await check("the agent preset realm is the first place compaction is looked up", async () => {
  const { calls, gateway } = await mountHost({ presetCompaction: true, agentCompaction: true, rootCompaction: true });
  await gateway[METHOD_NAME]("session-1");
  assert.deepEqual(calls.via, ["preset"]);
});

await check("an agent scope mounts compaction when no preset realm is composed", async () => {
  const { calls, gateway } = await mountHost({ presetRegistry: false, agentCompaction: true });
  await gateway[METHOD_NAME]("session-1");
  assert.deepEqual(calls.via, ["agent-scope"]);
});

await check("a host-plane compaction backend still serves the request", async () => {
  const { calls, gateway } = await mountHost({ presetRegistry: false, rootCompaction: true });
  await gateway[METHOD_NAME]("session-1");
  assert.deepEqual(calls.via, ["root"]);
});

await check("a preset registry without compaction falls through to the agent scope", async () => {
  const { calls, gateway } = await mountHost({ presetCompaction: false, agentCompaction: true });
  await gateway[METHOD_NAME]("session-1");
  assert.deepEqual(calls.via, ["agent-scope"]);
});

await check("no compaction anywhere fails loudly with the session named", async () => {
  const { gateway } = await mountHost({ presetCompaction: false });
  await assert.rejects(() => gateway[METHOD_NAME]("session-1"), /has no compaction capability in its agent scope/);
});

await check("a session without a live agent fails loudly", async () => {
  const { gateway } = await mountHost({ presetCompaction: true, live: false });
  await assert.rejects(() => gateway[METHOD_NAME]("session-1"), /has no live agent/);
});

await check("a span below the threshold is reported instead of compacted", async () => {
  const { calls, gateway } = await mountHost({ presetCompaction: true, minShadowedTokens: 5000 });
  const result = await gateway[METHOD_NAME]("session-1");
  assert.deepEqual({ ...result }, { outcome: "nothing-to-compact", shadowedNodes: 4, shadowedTokens: 40 });
  assert.equal(calls.compactRegion.length, 0);
});

await check("nothing older than the pending batch is reported without touching the seam", async () => {
  const surface = session([node(1, "system/message"), node(2, "assistant/message", 1)]);
  const { calls, gateway } = await mountHost({ surface, presetCompaction: true });
  const result = await gateway[METHOD_NAME]("session-1");
  assert.deepEqual({ ...result }, { outcome: "nothing-to-compact", shadowedNodes: 0, shadowedTokens: 0 });
  assert.equal(calls.compactRegion.length, 0);
});

await check("a compaction failure rejects with the seam's own diagnostic", async () => {
  const { gateway } = await mountHost({ presetCompaction: true, compactionFails: true });
  await assert.rejects(() => gateway[METHOD_NAME]("session-1"), /compaction already in progress/);
});

await check("the Remote call's cancellation signal reaches the compaction seam", async () => {
  const { app, calls } = await mountHost({ presetCompaction: true });
  const controller = new AbortController();
  // The gateway resolves the service from a context carrying `invocation`, which
  // is how the API gateway installs the carrier cancellation of one Remote call.
  const derived = app.extend({ invocation: { signal: controller.signal } });
  await derived.get("planCompactExec")[METHOD_NAME]("session-1");
  assert.equal(calls.compactRegion[0].signal, controller.signal);
});

console.log(failures === 0 ? "\nall host checks passed" : `\n${failures} host check(s) failed`);
process.exit(failures === 0 ? 0 : 1);