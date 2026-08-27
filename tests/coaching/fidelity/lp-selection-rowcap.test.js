'use strict';
/**
 * bd-zrlcp — the LP-selection list could be built with more rows than WhatsApp
 * accepts, and the whole prompt was then dropped.
 *
 * WhatsApp caps an interactive list at 10 rows TOTAL across all sections.
 * whatsapp.service.js enforces that itself: over the cap it logs a warning and
 * returns FALSE without ever contacting Meta. getRecentFidelityLps returned up
 * to 15 rows and the Options section always adds 2 more, so any teacher with 9+
 * recent lesson plans produced an undeliverable prompt — and every caller had
 * already moved the session to awaiting_lesson_plan, so it stranded there with
 * the coach seeing nothing (20 sessions on the morning of 2026-08-27).
 *
 * The recent-LP section therefore can never exceed 8 rows.
 */
const {
  buildLPSelectionList,
} = require('../../../bot/shared/services/coaching/lp-coaching/lp-selection-list.service');

const WHATSAPP_MAX_LIST_ROWS = 10; // Meta's hard limit, mirrored in whatsapp.service.js

function lps(n) {
  return Array.from({ length: n }, (_, i) => ({
    id: `asset-${i}`,
    lesson_id: `lesson-${i}`,
    topic: `Topic number ${i}`,
    grade: '4',
    subject: 'math',
    chapter_number: i + 1,
    day_label: `Day ${i + 1}`,
    pages_label: 'pp. 10-12',
    created_at: new Date(Date.now() - i * 86400000).toISOString(),
  }));
}

function totalRows(prompt) {
  return prompt.listData.action.sections.reduce((sum, s) => sum + s.rows.length, 0);
}

describe('bd-zrlcp · the LP selection list never exceeds the WhatsApp row cap', () => {
  test('15 recent lesson plans still produce a deliverable list (8 LP rows + 2 options)', () => {
    const prompt = buildLPSelectionList('sess-1', lps(15), 'en');
    expect(prompt.type).toBe('list');
    expect(totalRows(prompt)).toBeLessThanOrEqual(WHATSAPP_MAX_LIST_ROWS);
    expect(totalRows(prompt)).toBe(10);
    expect(prompt.listData.action.sections[0].rows).toHaveLength(8);
  });

  test('9 recent lesson plans — the first count that used to break — fit', () => {
    const prompt = buildLPSelectionList('sess-2', lps(9), 'en');
    expect(totalRows(prompt)).toBeLessThanOrEqual(WHATSAPP_MAX_LIST_ROWS);
    expect(prompt.listData.action.sections[0].rows).toHaveLength(8);
  });

  test('the most RECENT plans are the ones kept, not an arbitrary slice', () => {
    const prompt = buildLPSelectionList('sess-3', lps(15), 'en');
    const ids = prompt.listData.action.sections[0].rows.map((r) => r.id);
    // lps() is built most-recent-first, so asset-0 must survive and asset-14 must not.
    expect(ids[0]).toContain('asset-0');
    expect(ids.join('|')).not.toContain('asset-14');
  });

  test('a teacher under the cap is unchanged — 3 plans still render 3 + 2', () => {
    const prompt = buildLPSelectionList('sess-4', lps(3), 'en');
    expect(prompt.listData.action.sections[0].rows).toHaveLength(3);
    expect(totalRows(prompt)).toBe(5);
  });

  test('every list payload carries the 2-row Yes/No fallback for when it cannot be sent', () => {
    const prompt = buildLPSelectionList('sess-5', lps(15), 'en');
    expect(prompt.fallback).toBeDefined();
    expect(prompt.fallback.type).toBe('buttons');
    expect(prompt.fallback.buttons).toHaveLength(2);
    expect(prompt.fallback.buttons.map((b) => b.id)).toEqual([
      'lessonplan_yes_sess-5',
      'lessonplan_no_sess-5',
    ]);
  });

  test('the fallback is identical to what a teacher with no recent plans is sent', () => {
    const noRecents = buildLPSelectionList('sess-6', [], 'en');
    const withRecents = buildLPSelectionList('sess-6', lps(15), 'en');
    // Same prompt, so the two can never drift apart.
    expect(withRecents.fallback).toEqual(noRecents);
  });

  test('the Urdu fallback is Urdu', () => {
    const prompt = buildLPSelectionList('sess-7', lps(12), 'ur');
    expect(prompt.fallback.buttons.map((b) => b.title)).toEqual(['ہاں', 'نہیں']);
  });
});
