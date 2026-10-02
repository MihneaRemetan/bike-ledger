import '@testing-library/jest-dom/vitest';
import { afterEach, beforeEach, vi } from 'vitest';
import { cleanup } from '@testing-library/react';

// Newer Node versions ship an experimental global localStorage that shadows jsdom's, so use a plain in-memory one.
class MemoryStorage {
  #data = new Map();
  get length() { return this.#data.size; }
  key(i) { return [...this.#data.keys()][i] ?? null; }
  getItem(k) { return this.#data.has(String(k)) ? this.#data.get(String(k)) : null; }
  setItem(k, v) { this.#data.set(String(k), String(v)); }
  removeItem(k) { this.#data.delete(String(k)); }
  clear() { this.#data.clear(); }
}
for (const name of ['localStorage', 'sessionStorage']) {
  const storage = new MemoryStorage();
  Object.defineProperty(globalThis, name, { value: storage, configurable: true, writable: true });
  Object.defineProperty(window, name, { value: storage, configurable: true, writable: true });
}

// jsdom has no matchMedia. Desktop widths match by default; tests can flip the colour scheme.
const media = { dark: false, desktop: true };
globalThis.__media = media;
window.matchMedia = (query) => ({
  matches: query.includes('prefers-color-scheme') ? media.dark === query.includes('dark') : query.includes('min-width') ? media.desktop : false,
  media: query,
  addEventListener: () => {},
  removeEventListener: () => {},
  addListener: () => {},
  removeListener: () => {},
  dispatchEvent: () => false,
  onchange: null,
});
window.scrollTo = () => {};

// React Router v6 prints upgrade notices about v7 flags in every test run; they are not about our code
const realWarn = console.warn;
console.warn = (...args) => {
  if (typeof args[0] === 'string' && args[0].includes('React Router Future Flag Warning')) return;
  realWarn(...args);
};

beforeEach(() => {
  localStorage.clear();
  media.dark = false;
  media.desktop = true;
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});
