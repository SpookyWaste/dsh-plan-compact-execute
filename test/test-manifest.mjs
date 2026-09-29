/**
 * Wire-contract guard between the two halves.
 *
 * The browser bundle cannot import the host manifest — it must stay a classic
 * script — so it repeats the endpoint identity and the codec symbols as
 * literals. This test runs the shipped bundle, captures the contribution it
 * mounts, and compares it field by field with the host manifest, then proves the
 * host codecs still validate their wire boundaries in both codec generations.
 */
import assert from "node:assert/strict";
import { loadBundle, createCtxStub, BUNDLE_ID } from "./bundle.mjs";
import { TYPERT, compactBeforeExecuteResultSchema } from "../lib/typert.js";
import { ENDPOINT_ID, RESULT_SYMBOL, SESSION_ID_SYMBOL, SESSION_ID_WIRE } from "../lib/protocol.js";

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

const bundle = loadBundle();
const remote = { compactBeforeExecute: async () => ({ ok: true, value: { outcome: "compacted", shadowedNodes: 0, shadowedTokens: 0 } }) };
const { ctx, state } = createCtxStub({ remote });
await bundle.module.apply(ctx);

const contribution = state.mounted;
const hostInvocation = TYPERT.invocations[0];
const clientInvocation = contribution?.descriptors?.[0];

/** Cross-realm values carry the vm's prototypes, so compare their JSON projection. */
const plain = (value) => JSON.parse(JSON.stringify(value));

check("the bundle registers under the package name", () => {
  assert.equal(bundle.id, BUNDLE_ID);
});

check("the client half mounts exactly one descriptor for the host manifest", () => {
  assert.ok(contribution, "apply() never mounted a Remote contribution");
  assert.equal(contribution.package, TYPERT.package);
  assert.equal(contribution.descriptors.length, TYPERT.invocations.length);
});

check("endpoint identity, namespace, and invocation mode agree", () => {
  assert.equal(clientInvocation.id, hostInvocation.id);
  assert.equal(clientInvocation.id, ENDPOINT_ID);
  assert.equal(clientInvocation.service, hostInvocation.service);
  assert.equal(clientInvocation.namespace, hostInvocation.namespace);
  assert.equal(clientInvocation.method, hostInvocation.method);
  assert.deepEqual(plain(clientInvocation.invocation), plain(hostInvocation.invocation));
  assert.deepEqual(plain(clientInvocation.invocation), { kind: "direct" });
});

check("parameter wires and sources agree", () => {
  const strip = (parameters) => parameters.map(({ name, wire, source }) => ({ name, wire, source }));
  assert.deepEqual(plain(strip(clientInvocation.parameters)), plain(strip(hostInvocation.parameters)));
  assert.deepEqual(strip(hostInvocation.parameters), [{ name: SESSION_ID_WIRE, wire: SESSION_ID_WIRE, source: "json" }]);
});

check("type symbols agree on both sides", () => {
  assert.equal(hostInvocation.parameters[0].codec.typeSymbol, SESSION_ID_SYMBOL);
  assert.equal(clientInvocation.parameters[0].codec.typeSymbol, SESSION_ID_SYMBOL);
  assert.equal(hostInvocation.result.typeSymbol, RESULT_SYMBOL);
  assert.equal(clientInvocation.result.typeSymbol, RESULT_SYMBOL);
});

check("both faces carry both codec generations", () => {
  for (const codec of [hostInvocation.parameters[0].codec, hostInvocation.result, clientInvocation.parameters[0].codec, clientInvocation.result]) {
    assert.equal(codec.mode, "strict");
    assert.equal(typeof codec.create, "function");
    assert.equal(typeof codec.create().parse, "function");
    assert.equal(typeof codec.schema.parse, "function");
  }
});

check("the identity codec rejects an empty session id at the wire boundary", () => {
  assert.equal(hostInvocation.parameters[0].codec.create().parse("session-1"), "session-1");
  assert.throws(() => hostInvocation.parameters[0].codec.create().parse(""));
  assert.throws(() => hostInvocation.parameters[0].codec.create().parse(7));
});

check("the result codec accepts the two documented outcomes and nothing else", () => {
  assert.deepEqual(compactBeforeExecuteResultSchema.parse({ outcome: "nothing-to-compact", shadowedNodes: 0, shadowedTokens: 0 }), {
    outcome: "nothing-to-compact",
    shadowedNodes: 0,
    shadowedTokens: 0,
  });
  assert.throws(() => compactBeforeExecuteResultSchema.parse({ outcome: "compacted", shadowedNodes: -1, shadowedTokens: 0 }));
  assert.throws(() => compactBeforeExecuteResultSchema.parse({ outcome: "approved", shadowedNodes: 0, shadowedTokens: 0 }));
});

console.log(failures === 0 ? "\nall manifest checks passed" : `\n${failures} manifest check(s) failed`);
process.exit(failures === 0 ? 0 : 1);