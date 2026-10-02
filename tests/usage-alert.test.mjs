import test from 'node:test';
import assert from 'node:assert/strict';
import { dismissUntil, nearLimitWindows, usageAlertKey } from '../web/lib/usage-alert.mjs';

const now = Date.parse('2026-10-01T12:00:00Z');
const limits = {
  codex: { windows: [{ label: '5-hour', usedPercent: 89 }, { label: 'Weekly', usedPercent: 90, resetsAt: '2026-10-03T12:00:00Z' }] },
  claude: { windows: [{ label: 'Current session', usedPercent: 100, resetsAt: '2026-10-01T14:00:00Z' }, { label: 'Current week', usedPercent: null }] },
};

test('usage alert lists enabled provider windows at or above ninety percent', () => {
  assert.deepEqual(nearLimitWindows(limits, ['codex', 'claude']).map(window => `${window.providerId}:${window.label}`), ['codex:Weekly', 'claude:Current session']);
  assert.deepEqual(nearLimitWindows(limits, ['codex']).map(window => window.label), ['Weekly']);
  assert.deepEqual(nearLimitWindows(null, ['codex']), []);
  assert.deepEqual(nearLimitWindows({ claude: { available: false, windows: [] } }, ['claude']), []);
});

test('usage alert dismissal lasts until the earliest future reset and is keyed by window', () => {
  const windows = nearLimitWindows(limits, ['claude', 'codex']);
  assert.equal(usageAlertKey(windows), usageAlertKey([...windows].reverse()));
  assert.equal(dismissUntil(windows, now), Date.parse('2026-10-01T14:00:00Z'));
  assert.equal(dismissUntil([{ resetsAt: null }, { resetsAt: '2026-09-30T00:00:00Z' }], now), now + 5 * 60 * 60 * 1000);
});
