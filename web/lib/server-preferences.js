import { useSyncExternalStore } from 'react';
import { cacheText, fromCache, preferenceSpecs } from '../../src/preferences.mjs';

// Personal settings live on the dispatch server so a task or the CLI can change them; this keeps a browser cache
// so the first paint uses the last known value, and follows the server on every workspace refresh.
const cached = key => { try { return localStorage.getItem(key); } catch { return null; } };
const cache = (key, text) => { try { localStorage.setItem(key, text); } catch { /* Storage can be unavailable; the server keeps the value. */ } };
const send = (key, value) => fetch('/api/settings', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ key, value }) });
const values = Object.fromEntries(Object.entries(preferenceSpecs).map(([key, spec]) => [key, fromCache(key, cached(spec.cache)) ?? spec.default]));
const listeners = new Set(), pending = new Map();
let migrated = false;
const same = (left, right) => JSON.stringify(left) === JSON.stringify(right);

function store(key, value) {
  if (same(values[key], value)) return false;
  values[key] = value;
  cache(preferenceSpecs[key].cache, cacheText(key, value));
  return true;
}
const emit = () => listeners.forEach(listener => listener());
const subscribe = listener => { listeners.add(listener); return () => listeners.delete(listener); };

export const usePreference = key => useSyncExternalStore(subscribe, () => values[key]);
export const preferenceNow = key => values[key];

export function setPreference(key, value) {
  if (store(key, value)) emit();
  pending.set(key, (pending.get(key) ?? 0) + 1);
  send(key, value).catch(() => {}).finally(() => { const left = pending.get(key) - 1; if (left) pending.set(key, left); else pending.delete(key); });
}

// The first refresh after this change moves what this browser had saved to the server once, for anything the install never stored.
export function receivePreferences(server) {
  if (!server?.values) return;
  if (!migrated) {
    migrated = true;
    for (const key of server.unset ?? []) if (!same(values[key], preferenceSpecs[key].default)) setPreference(key, values[key]);
  }
  let changed = false;
  for (const [key, value] of Object.entries(server.values)) if (preferenceSpecs[key] && !pending.has(key) && !(server.unset ?? []).includes(key)) changed = store(key, value) || changed;
  if (changed) emit();
}
