/**
 * Shared harness for the browser-half regressions.
 *
 * `lib/client.js` is a classic script: it only registers a factory through
 * `window.__ModuleLoader__.load(...)`, and every side effect of the bundle lives
 * inside that factory. The harness reproduces the host's side of that contract —
 * a `__ModuleLoader__` stub, the shell seed modules it may `require`, a `document`
 * stub for the stylesheet, and a Cordis-context stub that records what the plugin
 * registers — so both the manifest-drift guard and the panel behavior test run
 * the shipped artifact exactly as a browser would.
 */
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

/** Browser module id this package must register under. */
export const BUNDLE_ID = "dsh-plan-compact-execute";

/** Dictionary namespace the plugin must own. */
export const NAMESPACE = "planCompact";

/** Remote namespace the host half must expose. */
export const SERVICE_KEY = "planCompactExec";

/**
 * Minimal React stub with a live hook row, so a test can drive `useState`
 * updates and re-render the same component.
 * @returns a React-shaped object plus the render entrypoint the driver rewires.
 */
export function createReactStub() {
  const hooks = [];
  let cursor = 0;
  let render = null;
  const React = {
    useState(initial) {
      const index = cursor++;
      if (!(index in hooks)) hooks[index] = typeof initial === "function" ? initial() : initial;
      const set = (next) => {
        hooks[index] = typeof next === "function" ? next(hooks[index]) : next;
        if (render !== null) render();
      };
      return [hooks[index], set];
    },
    useMemo(factory) {
      cursor++;
      return factory();
    },
    useEffect() {
      cursor++;
    },
    createElement(type, props, ...children) {
      return { type, props: props ?? {}, children };
    },
    Fragment: Symbol("Fragment"),
  };
  return {
    React,
    /** Bind the re-render callback used by this stub's state setters. */
    setRender(next) {
      render = next;
    },
    /** Start one render pass at the head of the hook row. */
    beginRender() {
      cursor = 0;
    },
    /** Drop the hook row: the framework remounts the card for a new request. */
    reset() {
      hooks.length = 0;
      cursor = 0;
    },
  };
}

/** Strip the markdown markers a plain-text projection would drop. */
function stripMarkers(text) {
  return text
    .replace(/^#{1,6}\s+/, "")
    .replace(/^[>*+-]\s+/, "")
    .replace(/[*_`]/g, "")
    .trim();
}

/** Extract the first visible line and the first non-heading paragraph the way the card does. */
function extractPlainText(markdown, options) {
  const blocks = markdown.split(/\n\s*\n/);
  if (options?.mode === "first-line") {
    const line = markdown.split("\n").find((candidate) => candidate.trim() !== "");
    return stripMarkers(line ?? "");
  }
  const paragraph = blocks.find((block) => block.trim() !== "" && !/^#{1,6}\s/.test(block.trim()));
  return stripMarkers((paragraph ?? "").split("\n").join(" "));
}

/**
 * Shell primitives stand-in: buttons become plain `button` elements so a test can
 * read their labels and click handlers, and markdown extraction returns the card's
 * title and description.
 * @returns a primitives-shaped object.
 */
export function createPrimitivesStub() {
  return {
    Button: "button",
    StateDot: "span",
    IconEditOutlineRegular: () => ({ type: "svg", props: {} }),
    IconCompactOutlineRegular: () => ({ type: "svg", props: {} }),
    extractMarkdownPlainText: extractPlainText,
  };
}

/**
 * Materialize the shipped browser bundle.
 * @param options - optional stub overrides.
 * @returns the captured module id, the factory exports, injected style tags, and warnings.
 */
export function loadBundle(options = {}) {
  const source = readFileSync(fileURLToPath(new URL("../lib/client.js", import.meta.url)), "utf8");
  const warnings = [];
  const styleTags = [];
  let captured = null;
  const documentStub = {
    querySelector: () => null,
    createElement: () => ({ dataset: {}, textContent: "" }),
    head: { appendChild: (tag) => styleTags.push(tag) },
  };
  const sandbox = {
    console: { ...console, warn: (...args) => warnings.push(args) },
    document: documentStub,
    window: { __ModuleLoader__: { load: (mod) => (captured = mod) } },
  };
  vm.createContext(sandbox);
  vm.runInContext(source, sandbox, { filename: "lib/client.js" });
  if (captured === null) throw new Error("bundle never called window.__ModuleLoader__.load");

  const react = options.react ?? createReactStub().React;
  const primitives = options.primitives ?? createPrimitivesStub();
  const requireStub = (specifier) => {
    if (specifier === "react") return react;
    if (specifier === "react/jsx-runtime") return { jsx: react.createElement, jsxs: react.createElement, Fragment: react.Fragment };
    if (specifier === "@deepseek-ai/dsh-client-ui-primitives") return primitives;
    throw new Error("browser bundle required a non-seed module: " + specifier);
  };
  return {
    id: captured.id,
    module: captured.factory(requireStub),
    styleTags,
    warnings,
    /**
     * Build an Error from the sandbox realm, so `instanceof Error` inside the
     * bundle behaves as it does in a browser (cross-realm errors do not).
     */
    vmError: (message) => new (vm.runInContext("Error", sandbox))(message),
  };
}

/**
 * Cordis-context stand-in recording every registration the client half makes.
 * @param options - `remote`: the remote face to expose, or `null` for an absent host half.
 * @returns the context stub plus the recorded state.
 */
export function createCtxStub(options = {}) {
  const dictionaries = new Map();
  const registrations = [];
  const injections = [];
  const state = {
    dictionaries,
    registrations,
    injections,
    mounted: undefined,
    mountFailure: options.mountFailure,
    remoteCalls: [],
  };
  const ctx = {
    effect(fn) {
      const dispose = fn();
      return typeof dispose === "function" ? dispose : () => {};
    },
    get(name) {
      if (name === "remote." + SERVICE_KEY) return state.remote ?? undefined;
      return undefined;
    },
    locale: {
      register(ns, dicts) {
        dictionaries.set(ns, dicts);
        return () => {};
      },
      bind: (ns) => (key, params) => {
        const dicts = dictionaries.get(ns) ?? { zh: {} };
        let text = (dicts.zh ?? dicts)[key];
        if (typeof text !== "string") return key;
        for (const [name, value] of Object.entries(params ?? {})) text = text.replace("{" + name + "}", String(value));
        return text;
      },
    },
    slots: {
      inject(name, callback) {
        injections.push(name);
        return callback();
      },
      register(registration, component) {
        registrations.push({ registration, component });
        return () => {};
      },
    },
    remote: {
      async $mount(contribution) {
        if (state.mountFailure !== undefined) throw state.mountFailure;
        state.mounted = contribution;
      },
    },
  };
  if (options.remote !== null && options.remote !== undefined) state.remote = options.remote;
  return { ctx, state };
}

/** Let queued microtasks and one macrotask settle. */
export function flush() {
  return new Promise((resolve) => setTimeout(resolve, 0));
}