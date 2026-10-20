'use strict';
/**
 * bd-z3cadk — ICT IAB row 23: the report on the portal screen has the same content as the WhatsApp image.
 *   - "Last time we asked": rebuilt from what the report stored (prioritized_action.uptake + the prior session's
 *     ask), with the image's own words (status pill + catalog line) in the report's language;
 *   - the progress graph's note: the narrative's journey_note;
 *   - a repeat recording says so, and carries the original report's date.
 */
const { lastAskedFromStored } = require('../../bot/shared/services/coaching/report-v2/uptake-line');
// "Last time we asked" needs the feedback-uptake loop (its status words in the image's style and its catalog lines).
// On a branch without the loop the block has nothing to show, so those cases wait for it rather than fail.
const { CHROME } = require('../../bot/shared/services/coaching/report-v2/hero-report.style');
const hasLoop = !!(CHROME.en && CHROME.en.uptake_achieved);
const withLoop = hasLoop ? test : test.skip;
const { narrativeView } = require('../../dashboard/services/report-narrative-view');
const { reportExtras } = require('../../dashboard/services/report-extras');

const priorCard = { action: 'Ask two "why" questions in the next lesson.', target: { indicator: 'C1', domain: 'C', name: 'Quality questioning' } };
const card = {
  action: 'Next: wait 3 seconds after each question.',
  hand_over: false,
  lineage: ['s-older', 's-prior'],
  uptake: { status: 'partial', target: 'C1', count: { why_questions: 1 } },
};

describe('"Last time we asked" from what was stored', () => {
  withLoop('English: the earlier ask, the status in the image\'s words, and the catalog line with the count', () => {
    const v = lastAskedFromStored(card, priorCard, 'en');
    expect(v.text).toBe(priorCard.action);
    expect(v.status).toBe('partial');
    expect(v.statusLabel).toBe('Getting there');
    expect(v.line).toMatch(/why questions 1/);
  });
  withLoop('Urdu: the status in Urdu', () => {
    expect(lastAskedFromStored(card, priorCard, 'ur').statusLabel).toBe('قریب');
  });
  test('nothing to show: no uptake, no prior card, or a prior without an ask', () => {
    expect(lastAskedFromStored({ ...card, uptake: null }, priorCard, 'en')).toBeNull();
    expect(lastAskedFromStored(card, null, 'en')).toBeNull();
    expect(lastAskedFromStored(card, { target: priorCard.target }, 'en')).toBeNull();
  });
});

test('the narrative view carries the graph\'s note', () => {
  const v = narrativeView({ report_narrative: { affirmation: 'A lively lesson', journey_note: 'Five lessons, and still climbing.' } });
  expect(v.journeyNote).toBe('Five lessons, and still climbing.');
});

describe('reportExtras: repeat recording, original date, last asked', () => {
  const rows = {
    'orig-1': { id: 'orig-1', created_at: '2026-09-29T09:49:24Z' },
    's-prior': { id: 's-prior', prioritized_action: priorCard },
  };
  const read = async (id) => rows[id] || null;

  test('a repeat: duplicate true, and the report date is the original\'s', async () => {
    const x = await reportExtras({ id: 'dup', created_at: '2026-10-20T07:56:43Z', duplicate_of_session_id: 'orig-1', prioritized_action: null }, 'ur', read);
    expect(x).toEqual(expect.objectContaining({ duplicate: true, reportDate: '2026-09-29T09:49:24Z', lastAsked: null }));
  });
  withLoop('a fresh report: not a repeat, its own date, and last asked from the prior session in its lineage', async () => {
    const x = await reportExtras({ id: 'new', created_at: '2026-10-20T11:04:59Z', duplicate_of_session_id: null, prioritized_action: card }, 'en', read);
    expect(x.duplicate).toBe(false);
    expect(x.reportDate).toBe('2026-10-20T11:04:59Z');
    expect(x.lastAsked).toEqual(expect.objectContaining({ text: priorCard.action, statusLabel: 'Getting there' }));
  });
  test('a read that fails never breaks the report', async () => {
    const x = await reportExtras({ id: 'new', created_at: 't', duplicate_of_session_id: 'gone', prioritized_action: card }, 'en', async () => { throw new Error('db'); });
    expect(x).toEqual({ duplicate: true, reportDate: 't', lastAsked: null });
  });
});
