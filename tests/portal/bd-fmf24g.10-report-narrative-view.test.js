/**
 * bd-fmf24g.10 — the teacher report payload carries the stored report narrative
 * (analysis_data.report_narrative), shaped for the app's report page, and nothing else of it.
 */
const { narrativeView } = require('../../dashboard/services/report-narrative-view');

const STORED = {
  topic: 'Fractions', affirmation: 'You made fractions feel easy', identity: 'A teacher who waits',
  moments: [
    { title: 'Pair talk', quote: 'Tell your partner why', why: 'Every child spoke' },
    { title: 'Second', quote: 'q2', why: 'w2' },
  ],
  strength_name: 'Wait time', strength_note: 'You waited.', horizon_title: 'Name one moment', horizon_note: 'Quote it.',
  domain_whys: { teacher_subject_knowledge: 'Clear examples.', bad: '', worse: 7 }, journey_note: 'Up from last time',
  _language: 'ur', generated_at: '2026-10-09T10:00:00.000Z', lesson_mismatch_taught: 'never served',
};

describe('narrativeView', () => {
  test('maps the stored narrative to the page\'s words: headline, identity, moments, strength, horizon, whys', () => {
    expect(narrativeView({ report_narrative: STORED })).toEqual({
      headline: 'You made fractions feel easy',
      identity: 'A teacher who waits',
      moments: [
        { title: 'Pair talk', quote: 'Tell your partner why', why: 'Every child spoke' },
        { title: 'Second', quote: 'q2', why: 'w2' },
      ],
      strength: { title: 'Wait time', note: 'You waited.' },
      horizon: { title: 'Name one moment', note: 'Quote it.' },
      domainWhys: { teacher_subject_knowledge: 'Clear examples.' },
      language: 'ur',
    });
  });

  test('absent, empty or malformed → null (an older session, or one whose narrative failed)', () => {
    for (const a of [null, undefined, {}, { report_narrative: null }, { report_narrative: {} }, { report_narrative: 'x' }, { report_narrative: { moments: [] } }]) {
      expect(narrativeView(a)).toBeNull();
    }
  });

  test('a half-written narrative keeps what it has and leaves the rest out', () => {
    const v = narrativeView({ report_narrative: { strength_name: 'Wait time' } });
    expect(v).toMatchObject({ headline: '', identity: '', moments: [], strength: { title: 'Wait time', note: '' }, horizon: null, domainWhys: {} });
  });
});
