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
  const effectDeps = [];
  let pendingEffects = [];
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
    /**
     * Record one effect for the driver's explicit flush. React runs effects after
     * the commit, so this stub queues them instead of running them mid-render;
     * `flushEffects` then runs the ones whose dependencies changed.
     */
    useEffect(fn, deps) {
      pendingEffects.push({ index: cursor++, fn, deps });
    },
    useRef(initial) {
      cursor++;
      return { current: initial };
    },
    /**
     * Remaining hook kinds the installed official bundles reach for. Each keeps
     * the hook row aligned (one cursor slot) and stays inert, matching how this
     * harness treats effect timing.
     */
    useCallback(fn) {
      cursor++;
      return fn;
    },
    useLayoutEffect(fn, deps) {
      pendingEffects.push({ index: cursor++, fn, deps });
    },
    useSyncExternalStore(_subscribe, getSnapshot) {
      cursor++;
      return getSnapshot();
    },
    useId() {
      return "hook-" + cursor++;
    },
    useDebugValue() {
      cursor++;
    },
    useContext(context) {
      cursor++;
      return context?._currentValue;
    },
    createContext(initial) {
      return { _currentValue: initial, Provider: Symbol("Provider"), Consumer: Symbol("Consumer") };
    },
    /** Identity wrapper: the expansion used by the parity gate unwraps functions. */
    memo(component) {
      return component;
    },
    forwardRef(render) {
      return (props) => render(props, null);
    },
    isValidElement(value) {
      return typeof value === "object" && value !== null && "type" in value;
    },
    Children: { toArray: (value) => (Array.isArray(value) ? value : value === undefined || value === null ? [] : [value]) },
    /**
     * Classic-runtime factory. The automatic runtime (`jsx`/`jsxs`, used by the
     * official bundles) hands children through `props.children` instead of the
     * argument list, so both shapes normalize to one `children` list here.
     */
    createElement(type, props, ...children) {
      const declared = props?.children;
      const list = children.length > 0 ? children : declared === undefined ? [] : Array.isArray(declared) ? declared : [declared];
      return { type, props: props ?? {}, children: list };
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
    /**
     * Run the effects queued by the last render pass whose dependencies changed.
     * A hook index with no recorded dependencies runs once per mount, matching
     * React's unconditional effect.
     */
    flushEffects() {
      const queued = pendingEffects;
      pendingEffects = [];
      for (const { index, fn, deps } of queued) {
        const previous = effectDeps[index];
        const changed = previous === undefined || deps === undefined
          || deps.length !== previous.length
          || deps.some((dep, offset) => dep !== previous[offset]);
        if (!changed) continue;
        effectDeps[index] = deps === undefined ? [] : [...deps];
        fn();
      }
    },
    /** Drop the hook row: the framework remounts the card for a new request. */
    reset() {
      hooks.length = 0;
      effectDeps.length = 0;
      pendingEffects = [];
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
    IconChevronRightOutlineRegular: () => ({ type: "svg", props: {} }),
    extractMarkdownPlainText: extractPlainText,
  };
}

/**
 * Session-store stand-in: the bundle only hands the declared store to the slot
 * registry as a definition, so the factory's identity suffices.
 * @returns a store-module-shaped object.
 */
export function createStoreStub() {
  return { defineStore: (definition) => definition };
}

/**
 * Read one browser bundle as a classic script and materialize its factory.
 *
 * The caller chooses the file (the shipped plugin bundle, or an installed
 * official bundle for a parity gate) and may supply the seed-module stubs; the
 * synchronous `require` accepts exactly the shell seed words the real module
 * loader materializes without a graph row, and throws on anything else so a
 * bundle that grows a new module edge fails loudly.
 *
 * @param path - absolute path of the bundle file.
 * @param options - optional react, primitives, and store stub overrides.
 * @returns the captured module id, the factory exports, injected style tags, and warnings.
 */
export function loadBundleAt(path, options = {}) {
  const source = readFileSync(path, "utf8");
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
    // Bundles may draw browser-unique identities at module scope (0.2.0's
    // question cards seed a reload-unique prefix), so the sandbox carries the
    // same WebCrypto the browser exposes.
    crypto: globalThis.crypto,
    setTimeout,
    clearTimeout,
  };
  vm.createContext(sandbox);
  vm.runInContext(source, sandbox, { filename: path });
  if (captured === null) throw new Error("bundle never called window.__ModuleLoader__.load: " + path);

  const react = options.react ?? createReactStub().React;
  const primitives = options.primitives ?? createPrimitivesStub();
  const store = options.store ?? createStoreStub();
  const requireStub = (specifier) => {
    if (specifier === "react") return react;
    if (specifier === "react/jsx-runtime") return { jsx: react.createElement, jsxs: react.createElement, Fragment: react.Fragment };
    if (specifier === "@deepseek-ai/dsh-client-ui-primitives") return primitives;
    if (specifier === "@deepseek-ai/dsh-client-store") return store;
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
 * Materialize the shipped browser bundle.
 * @param options - optional stub overrides.
 * @returns the captured module id, the factory exports, injected style tags, and warnings.
 */
export function loadBundle(options = {}) {
  return loadBundleAt(fileURLToPath(new URL("../lib/client.js", import.meta.url)), options);
}

/**
 * Session pending-interaction registry stand-in, following the installed
 * `dsh-client-ui-session` rules: one domain per `registerPendingInteraction`
 * call, a publisher per interaction, and a per-session winner elected by
 * descending precedence (`precedence >= previous.precedence`, so a later domain
 * wins a tie). Both a plugin that publishes and a test that asks who currently
 * owns a session read this one table, which is what makes the compaction lock's
 * displacement observable.
 *
 * @returns the registry: `registerPendingInteraction`, the current winner per
 * session, and the publication each domain currently holds.
 */
export function createPendingRegistry() {
  const domains = [];
  const listeners = new Set();
  let winners = new Map();
  const recompute = () => {
    const next = new Map();
    for (const domain of domains) {
      for (const record of domain.entries.values()) {
        const precedence = domain.precedence(record.interaction);
        const previous = next.get(record.interaction.sessionId);
        if (previous === undefined || precedence >= previous.precedence) {
          next.set(record.interaction.sessionId, { interaction: record.interaction, precedence });
        }
      }
    }
    winners = new Map([...next].map(([sessionId, value]) => [sessionId, value.interaction]));
    for (const listener of [...listeners]) listener();
  };
  return {
    registerPendingInteraction(precedence) {
      const domain = { precedence, entries: new Map() };
      domains.push(domain);
      recompute();
      return (interaction, delegate) => {
        domain.entries.set(interaction.key, { interaction, delegate });
        recompute();
        return () => {
          if (!domain.entries.delete(interaction.key)) return;
          recompute();
        };
      };
    },
    /** Interactions held per domain, in registration order. */
    domains,
    /** @param sessionId - session to inspect. @returns the interaction winning that session. */
    winner(sessionId) {
      return winners.get(sessionId);
    },
    /** @param listener - callback invoked after every election. @returns the unsubscribe. */
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}

/**
 * Standard props the slot renderer composes for one session-scoped entry: the
 * Session identity plus the root standard kit, whose `useSessionStatus` reads
 * the live pending-interaction winner — exactly the source the official panel's
 * `pendingInteraction` owner prop comes from.
 *
 * @param options - `sessionId`, and the registry the status reads.
 * @returns the standard props share.
 */
export function composeStandardProps({ sessionId, registry }) {
  const statuses = () => {
    const status = new Map();
    if (registry !== undefined) {
      const winner = registry.winner(sessionId);
      if (winner !== undefined) status.set(sessionId, { running: true, pendingInteraction: winner, completionUnread: false });
    }
    return status;
  };
  return {
    sessionId,
    useSessionStatus: (selector) => selector(statuses()),
    useSessions: (selector) => selector({ ids: [sessionId], byId: {}, phase: "ready" }),
    useSession: (selector) => selector(undefined),
    useProjection: () => undefined,
  };
}

/**
 * Cordis-context stand-in recording every registration the client half makes.
 *
 * The stub enforces cordis's inject discipline: a plugin may read a service or a
 * provided property only when its own `inject` list declares it (`ctx.get()`
 * stays open, exactly as in the runtime). Passing the bundle's own `inject` list
 * therefore turns "read a service I never declared" into a test failure instead
 * of a silent extra capability — the mistake that took the whole plan-review
 * card down in the browser (`cannot get property "sidebarRight" without inject`).
 *
 * @param options - `remote`: the remote face to expose, or `null` for an absent
 * host half; `inject`: the service names this plugin declared; `services`:
 * extra values `ctx.get()` resolves (for example a provided `sidebarRight`).
 * @returns the context stub plus the recorded state.
 */
export function createCtxStub(options = {}) {
  const dictionaries = new Map();
  const registrations = [];
  const injections = [];
  const services = new Map();
  const pending = options.pending ?? createPendingRegistry();
  const uiSession = options.uiSession ?? { registerPendingInteraction: (precedence) => pending.registerPendingInteraction(precedence) };
  services.set("uiSession", uiSession);
  const state = {
    dictionaries,
    registrations,
    injections,
    services,
    pending,
    mounted: undefined,
    mountFailure: options.mountFailure,
    remoteCalls: [],
  };
  for (const [name, value] of Object.entries(options.services ?? {})) services.set(name, value);
  const readable = new Set([
    "effect", "get", "inject", "root", "fiber", "logger", "reflect", "uiConversation",
    ...(options.inject ?? ["slots", "locale", "remote", "uiSession", "sessions"]),
  ]);
  const ctx = {
    effect(fn) {
      const dispose = fn();
      return typeof dispose === "function" ? dispose : () => {};
    },
    get(name) {
      if (name === "remote." + SERVICE_KEY) return state.remote ?? undefined;
      return services.get(name);
    },
    /**
     * Cordis's optional-injection form: run the callback only while every named
     * service exists, and hand it a context that may read them as properties.
     */
    inject(names, callback) {
      const missing = names.filter((name) => !services.has(name));
      if (missing.length > 0) return () => {};
      const injected = { ...ctx, ...Object.fromEntries(names.map((name) => [name, services.get(name)])) };
      callback(injected);
      return () => {};
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
      $on() {
        return () => {};
      },
    },
    uiSession: uiSession ?? {},
    /**
     * Faces the installed official bundles reach for while registering. Provided
     * values land in the same service table `ctx.get()` reads, so a bundle that
     * publishes one and a bundle that consumes it through `get` stay consistent.
     */
    reflect: {
      provide(name, value) {
        services.set(name, value);
        return () => services.delete(name);
      },
      store: {},
    },
    uiConversation: {
      events: { register: () => () => {} },
      binding: () => undefined,
    },
  };
  const guarded = new Proxy(ctx, {
    get(target, key, receiver) {
      if (typeof key === "symbol") return Reflect.get(target, key, receiver);
      if (readable.has(key)) return Reflect.get(target, key, receiver);
      throw new Error(`cannot get property "${key}" without inject`);
    },
  });
  if (options.remote !== null && options.remote !== undefined) state.remote = options.remote;
  return { ctx: guarded, state };
}

/** Let queued microtasks and one macrotask settle. */
export function flush() {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

/**
 * Compose one entry's inject face into component props the way the slot renderer
 * does: plain members keep their names, `hooks` members surface under their
 * `use<Name>` prop name, and `keyedHooks` stays a single `keyedHooks` seat.
 *
 * @param face - value returned by the entry's `inject` callback.
 * @returns the props that face contributes.
 */
export function composeInjectProps(face) {
  const { hooks, keyedHooks, ...plain } = face ?? {};
  const props = { ...plain };
  for (const [name, hook] of Object.entries(hooks ?? {})) {
    props[`use${name[0].toUpperCase()}${name.slice(1)}`] = hook;
  }
  if (keyedHooks !== undefined) props.keyedHooks = keyedHooks;
  return props;
}

/** Breadth-first collect of every element in a rendered tree. */
export function elements(node) {
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
export function stringsIn(node) {
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