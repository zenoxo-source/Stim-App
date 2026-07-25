// tests/helpers/dom-mock.js - Browser-environment shims for running frontend
// modules under Node. Import this BEFORE importing any frontend module.
// Without it, `new Audio()` (state.js) and `document.addEventListener`
// (every module's DOMContentLoaded block) would throw under Node.

class FakeEventTarget {
  constructor() {
    this._listeners = new Map();
  }
  addEventListener(type, fn) {
    if (!this._listeners.has(type)) this._listeners.set(type, []);
    this._listeners.get(type).push(fn);
  }
  removeEventListener(type, fn) {
    const arr = this._listeners.get(type);
    if (arr) {
      const i = arr.indexOf(fn);
      if (i >= 0) arr.splice(i, 1);
    }
  }
  dispatchEvent(ev) {
    const arr = this._listeners.get(ev?.type) || [];
    for (const fn of arr) fn(ev);
    return true;
  }
}

/**
 * Match a single simple selector against an element.
 * Supports the forms the frontend actually uses: "[attr]", "#id", ".class",
 * "tag". Compound and descendant selectors are intentionally out of scope.
 */
function matchesSelector(el, selector) {
  const sel = selector.trim();
  if (!sel) return false;
  if (sel.startsWith("[") && sel.endsWith("]")) {
    const body = sel.slice(1, -1);
    const eq = body.indexOf("=");
    if (eq < 0) return el.hasAttribute(body);
    const name = body.slice(0, eq);
    const want = body.slice(eq + 1).replace(/^["']|["']$/g, "");
    return el.getAttribute(name) === want;
  }
  if (sel.startsWith("#")) return el.attributes.id === sel.slice(1);
  if (sel.startsWith(".")) return el.classList.contains(sel.slice(1));
  return el.tagName === sel.toUpperCase();
}

/** Depth-first walk over an element subtree, including the root. */
function* walkElements(el) {
  yield el;
  for (const child of el.children) {
    if (child && Array.isArray(child.children)) yield* walkElements(child);
  }
}

class FakeElement extends FakeEventTarget {
  constructor(tagName = "div") {
    super();
    this.tagName = String(tagName).toUpperCase();
    this.children = [];
    this.parentElement = null;
    this.attributes = {};
    this.style = {};
    this.dataset = {};
    this.classList = {
      _set: new Set(),
      add(...c) {
        c.forEach((x) => this._set.add(x));
      },
      remove(...c) {
        c.forEach((x) => this._set.delete(x));
      },
      toggle(c, force) {
        if (force === true || (force === undefined && !this._set.has(c))) this._set.add(c);
        else this._set.delete(c);
      },
      contains(c) {
        return this._set.has(c);
      },
    };
    this.textContent = "";
    this.innerHTML = "";
    this.value = "";
    this.checked = false;
    this.disabled = false;
  }
  appendChild(c) {
    this.children.push(c);
    if (c && typeof c === "object") c.parentElement = this;
    return c;
  }
  removeChild(c) {
    const i = this.children.indexOf(c);
    if (i >= 0) this.children.splice(i, 1);
    if (c && typeof c === "object") c.parentElement = null;
    return c;
  }
  remove() {
    if (this.parentElement) this.parentElement.removeChild(this);
  }
  setAttribute(k, v) {
    this.attributes[k] = String(v);
    // Keep dataset in sync so modules can read el.dataset.i18n
    if (k.startsWith("data-")) {
      const prop = k
        .slice(5)
        .replace(/-([a-z])/g, (_, ch) => ch.toUpperCase());
      this.dataset[prop] = String(v);
    }
  }
  getAttribute(k) {
    return this.attributes[k] ?? null;
  }
  hasAttribute(k) {
    return k in this.attributes;
  }
  removeAttribute(k) {
    delete this.attributes[k];
  }
  querySelector(sel) {
    return this.querySelectorAll(sel)[0] ?? null;
  }
  querySelectorAll(sel) {
    if (!sel) return [];
    const out = [];
    for (const el of walkElements(this)) {
      if (el !== this && matchesSelector(el, sel)) out.push(el);
    }
    return out;
  }
  getElementById(id) {
    for (const el of walkElements(this)) {
      if (el !== this && el.attributes.id === id) return el;
    }
    return null;
  }
  getContext() {
    return null;
  }
  getBoundingClientRect() {
    return { x: 0, y: 0, width: 0, height: 0, top: 0, left: 0, right: 0, bottom: 0 };
  }
}

class FakeDocument extends FakeEventTarget {
  constructor() {
    super();
    this.documentElement = new FakeElement("html");
    this.body = new FakeElement("body");
    this.readyState = "complete";
  }
  createElement(tag) {
    return new FakeElement(tag);
  }
  createTextNode(t) {
    return { textContent: String(t) };
  }
  getElementById(id) {
    return this.body.getElementById(id);
  }
  querySelector(sel) {
    return this.body.querySelector(sel);
  }
  querySelectorAll(sel) {
    return this.body.querySelectorAll(sel);
  }
  /**
   * Minimal TreeWalker for SHOW_TEXT.
   *
   * The mock has no separate text nodes — an element carries its text in
   * `textContent`. So each leaf element with text yields one pseudo text node
   * whose writes propagate back to the element. Enough to exercise text-node
   * logic; not a substitute for a real DOM.
   */
  createTreeWalker(root, whatToShow) {
    const nodes = [];
    if (whatToShow === undefined || whatToShow & 4 /* SHOW_TEXT */) {
      for (const el of walkElements(root)) {
        if (el.children.length === 0 && el.textContent) {
          nodes.push({
            get textContent() {
              return el.textContent;
            },
            set textContent(v) {
              el.textContent = v;
            },
            parentElement: el,
          });
        }
      }
    }
    let i = -1;
    return {
      nextNode() {
        i += 1;
        return i < nodes.length ? nodes[i] : null;
      },
    };
  }
  addEventListener() {
    /* swallow — many modules register DOMContentLoaded; we don't fire it */
  }
}

class FakeAudio extends FakeEventTarget {
  constructor() {
    super();
    this.src = "";
    this.currentTime = 0;
    this.duration = 0;
    this.ended = false;
    this.paused = true;
  }
  play() {
    this.paused = false;
    return Promise.resolve();
  }
  pause() {
    this.paused = true;
  }
  load() {
    /* no-op */
  }
}

class FakeLocalStorage {
  constructor() {
    this._store = new Map();
  }
  getItem(k) {
    return this._store.has(k) ? this._store.get(k) : null;
  }
  setItem(k, v) {
    this._store.set(k, String(v));
  }
  removeItem(k) {
    this._store.delete(k);
  }
  clear() {
    this._store.clear();
  }
}

function installDomMocks() {
  if (!globalThis.document) {
    globalThis.document = new FakeDocument();
  }
  if (!globalThis.window) {
    globalThis.window = globalThis;
  }
  if (!globalThis.localStorage) {
    globalThis.localStorage = new FakeLocalStorage();
  }
  if (!globalThis.Audio) {
    globalThis.Audio = FakeAudio;
  }
  if (!globalThis.navigator) {
    globalThis.navigator = { bluetooth: {} };
  }
  if (!globalThis.NodeFilter) {
    globalThis.NodeFilter = { SHOW_TEXT: 4, SHOW_ELEMENT: 1, SHOW_ALL: 0xffffffff };
  }
  if (!globalThis.MutationObserver) {
    // Inert by default — tests drive translation explicitly via apply().
    globalThis.MutationObserver = class MutationObserver {
      constructor(cb) {
        this.callback = cb;
      }
      observe() {}
      disconnect() {}
      takeRecords() {
        return [];
      }
    };
  }
  if (!globalThis.requestAnimationFrame) {
    globalThis.requestAnimationFrame = () => 0;
  }
  if (!globalThis.cancelAnimationFrame) {
    globalThis.cancelAnimationFrame = () => {};
  }
  if (!globalThis.confirm) {
    globalThis.confirm = () => true;
  }
  if (!globalThis.alert) {
    globalThis.alert = () => {};
  }
  if (!globalThis.URL.createObjectURL) {
    globalThis.URL.createObjectURL = () => "blob:mock";
    globalThis.URL.revokeObjectURL = () => {};
  }
  if (!globalThis.Blob) {
    globalThis.Blob = class Blob {
      constructor(parts) {
        this.parts = parts;
      }
    };
  }
}

installDomMocks();

export { FakeElement, FakeDocument, FakeAudio };
