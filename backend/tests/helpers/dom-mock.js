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

class FakeElement extends FakeEventTarget {
  constructor(tagName = "div") {
    super();
    this.tagName = String(tagName).toUpperCase();
    this.children = [];
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
    return c;
  }
  removeChild(c) {
    const i = this.children.indexOf(c);
    if (i >= 0) this.children.splice(i, 1);
    return c;
  }
  remove() {
    /* no-op */
  }
  setAttribute(k, v) {
    this.attributes[k] = String(v);
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
  querySelector() {
    return null;
  }
  querySelectorAll() {
    return [];
  }
  getElementById() {
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
  getElementById() {
    return null;
  }
  querySelector() {
    return null;
  }
  querySelectorAll() {
    return [];
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
