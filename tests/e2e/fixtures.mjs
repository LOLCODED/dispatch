import { test as base, expect } from '@playwright/test';
import { preferenceSpecs } from '../../src/preferences.mjs';

// Preferences are server settings shared by every page, so each test starts from the defaults rather than the last test's choices.
export const test = base.extend({
  preferences: [async ({ request }, use) => {
    for (const [key, spec] of Object.entries(preferenceSpecs)) await request.post('/api/settings', { data: { key, value: spec.default } });
    await use();
  }, { auto: true }],
});
export { expect };
