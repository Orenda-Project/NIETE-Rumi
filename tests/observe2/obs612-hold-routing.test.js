'use strict';
/**
 * bd-pni007 — an FDE visit made in /observe has a form row too (visit_context.via 'observe'). It is an /observe
 * visit: a coach whose latest observation it was is not routed as an /observe2 coach (their next unarmed recording
 * is not held for a form).
 */
jest.mock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn() }));
jest.mock('../../bot/shared/config/feature-availability', () => ({ isFeatureRunnable: () => true }));
const mockLatest = { form: null, linked: null };
jest.mock('../../bot/shared/services/observe/observe2/field-form.store', () => ({
  latestFormOf: jest.fn(() => Promise.resolve({ ok: true, form: mockLatest.form })),
  findBySession: jest.fn(() => Promise.resolve({ ok: true, form: mockLatest.linked })),
}));
jest.mock('../../bot/shared/config/supabase', () => ({
  from: () => {
    const q = {};
    q.select = () => q; q.eq = () => q; q.neq = () => q; q.order = () => q;
    q.limit = () => Promise.resolve({ data: [{ id: 'sess-1', created_at: '2026-11-11T10:00:00Z' }], error: null });
    return q;
  },
}));
const { prefersObserve2 } = require('../../bot/shared/services/observe/observe2/hold');

test('the latest form made by /observe for its FDE visit: not an /observe2 coach', async () => {
  mockLatest.form = { id: 'f', created_at: '2026-11-11T10:00:01Z', visit_context: { via: 'observe' } };
  mockLatest.linked = { id: 'f', visit_context: { via: 'observe' } };
  expect(await prefersObserve2('coach-1')).toBe(false);
});

test('an /observe2 form (FDE or FICO): an /observe2 coach, as before', async () => {
  mockLatest.form = { id: 'f', created_at: '2026-11-11T10:00:01Z', visit_context: { via: 'observe2' } };
  expect(await prefersObserve2('coach-1')).toBe(true);
  mockLatest.form = { id: 'f', created_at: '2026-11-11T09:00:00Z', visit_context: {} };
  mockLatest.linked = { id: 'f', visit_context: {} };
  expect(await prefersObserve2('coach-1')).toBe(true);
});
