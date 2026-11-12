'use strict';
/**
 * /observe2 retired for a coach (app_settings.observe2_retired): a recording that comes with no form waiting is not
 * held as a NEW /observe2 visit, even when the coach's latest observation was an /observe2 one. It takes the /observe
 * path. Off (the default): routing exactly as before.
 */
jest.mock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn() }));
jest.mock('../../bot/shared/config/feature-availability', () => ({ isFeatureRunnable: () => true }));
const mockRetired = { on: false };
jest.mock('../../bot/shared/services/observe/observe2/retire', () => ({
  isRetired: jest.fn(async () => mockRetired.on),
}));
jest.mock('../../bot/shared/services/observe/observe2/field-form.store', () => ({
  // The coach's newest form is an /observe2 one, newer than any classic observation.
  latestFormOf: jest.fn(() => Promise.resolve({ ok: true, form: { id: 'f', created_at: '2026-11-12T10:00:01Z', visit_context: {} } })),
  findBySession: jest.fn(() => Promise.resolve({ ok: true, form: { id: 'f', visit_context: {} } })),
}));
jest.mock('../../bot/shared/config/supabase', () => ({
  from: () => {
    const q = {};
    q.select = () => q; q.eq = () => q; q.neq = () => q; q.order = () => q;
    q.limit = () => Promise.resolve({ data: [{ id: 'sess-1', created_at: '2026-11-12T09:00:00Z' }], error: null });
    return q;
  },
}));
const { prefersObserve2 } = require('../../bot/shared/services/observe/observe2/hold');
const Retire = require('../../bot/shared/services/observe/observe2/retire');

test('switch off: an /observe2 coach\'s unarmed recording is held for a form, as before', async () => {
  mockRetired.on = false;
  expect(await prefersObserve2('coach-1')).toBe(true);
});

test('switch on for this coach: no new /observe2 visit is started from a recording', async () => {
  mockRetired.on = true;
  expect(await prefersObserve2('coach-1')).toBe(false);
  expect(Retire.isRetired).toHaveBeenCalledWith(expect.objectContaining({ userId: 'coach-1' }));
});
