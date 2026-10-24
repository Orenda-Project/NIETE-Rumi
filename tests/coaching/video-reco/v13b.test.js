'use strict';
/**
 * bd-gzfdu9 — SPEC v1.3b (lead-review 19:51Z answer): prompt vr-4 wording; one bounded validation retry;
 * attempts + first_none_reason stored (V1.7.2, additive).
 */
const fs = require('fs');
const path = require('path');
const P = require('../../../bot/shared/services/coaching/video-reco/prompt');
const C = require('../../../bot/shared/services/coaching/video-reco/catalog');

const cat = C.fromData(require('./fixtures/catalog.fixture.json'));
const target = { indicator: 'C1', source: 'step', row: { id: 'C1', name: 'Quality Questioning', score: 1, timestamp: '[03:10]' } };
const cands = [{ seg_id: '10-s1', indicator: 'C1' }, { seg_id: '11-s1', indicator: 'C1' }];

describe('prompt vr-4: "scorer" leaves the prompt, except the rule that forbids mentioning one', () => {
  test('PROMPT_VERSION is vr-11 (vr-4 wording, v1.3c-3, r7, R7b, R7c + R7g Urdu words + R7j terms file)', () => expect(P.PROMPT_VERSION).toBe('vr-11'));

  test('the scorer quote line reads "The report\'s own moment"; rule 2 copies "from the report\'s moment or the TRANSCRIPT MOMENTS"', () => {
    const p = P.build({ target, rationale: 'r', tryText: 't', excerpts: ['[03:00] Teacher: hello'], candidates: cands, catalog: cat, scorerQuote: 'Is this red? Yes or no' });
    expect(p).toContain('The report\'s own moment: "Is this red? Yes or no" (around [03:10]). Cite it unless a transcript line below fits the clip better.');
    expect(p).toContain('a short quote copied from the report\'s moment or the TRANSCRIPT MOMENTS');
    expect(p.replace('never mention the scorer', '')).not.toMatch(/scorer/i);
  });

  test('the uptake quote (card_text) and the no-transcript placeholder carry no "scorer" either', () => {
    const p = P.build({ target: { source: 'card_text' }, rationale: '', tryText: 't', excerpts: [], candidates: cands, catalog: cat, uptakeQuote: 'finished early' });
    expect(p).toContain('The report\'s own moment: "finished early"');
    expect(p.replace('never mention the scorer', '')).not.toMatch(/scorer/i);
  });
});

describe('V1.7.2: attempts + first_none_reason, additive', () => {
  const dir = path.join(__dirname, '../../../infrastructure/supabase/migrations');
  const up = () => fs.readFileSync(path.join(dir, 'V1.7.2__video_recommendations_retry.sql'), 'utf8');
  const down = () => fs.readFileSync(path.join(dir, 'ROLLBACK_V1.7.2__video_recommendations_retry.sql'), 'utf8');
  test('adds the two columns with IF NOT EXISTS and nothing destructive', () => {
    expect(up()).toMatch(/ADD COLUMN IF NOT EXISTS attempts\s+smallint/i);
    expect(up()).toMatch(/ADD COLUMN IF NOT EXISTS first_none_reason\s+text/i);
    expect(up()).not.toMatch(/\bDROP\b|\bRENAME\b|ALTER COLUMN/i);
    expect(up()).toMatch(/CHECK \(attempts IS NULL OR attempts IN \(1, 2\)\)/i);
  });
  test('r-ab EVENTS_SCHEMA §3b: report_language_null, lesson_language, chapter_language (additive)', () => {
    expect(up()).toMatch(/ADD COLUMN IF NOT EXISTS report_language_null\s+BOOLEAN/i);
    expect(up()).toMatch(/ADD COLUMN IF NOT EXISTS lesson_language\s+TEXT/i);
    expect(up()).toMatch(/ADD COLUMN IF NOT EXISTS chapter_language\s+TEXT/i);
    expect(down()).toMatch(/DROP COLUMN IF EXISTS chapter_language/i);
  });
  test('the rollback drops exactly those two columns', () => {
    expect(down()).toMatch(/DROP COLUMN IF EXISTS attempts/i);
    expect(down()).toMatch(/DROP COLUMN IF EXISTS first_none_reason/i);
  });
});

describe('SPEC v1.3b NO_MOVE = {B7, C10} on the 37 scheme (lead-review 20:16Z): none hole:no_move before any route', () => {
  const T = require('../../../bot/shared/services/coaching/video-reco/target');
  const S = require('../../../bot/shared/services/coaching/video-reco/shortlist');
  const a37 = (rows) => ({ framework: 'fico', indicator_scheme: 'fico_main_37', domains: { B: { indicators: rows } } });
  const row = (id, score = 1, extra = {}) => ({ id, name: id, score, applicable: true, evidence: 'x', ...extra });
  const L = { subject: 'urdu', grade: { lo: 3, hi: 3 }, topic: null, inapplicable: [] };
  const ctx = { language: 'ur', languages: ['ur', 'mixed'], level: 2, ladderComplete: false, history: { segments: [], modules: [] } };

  test.each([
    ['step B7', a37([row('B7')]), { target: { indicator: 'B7' } }, null],
    ['step C10', a37([row('C10')]), { target: { indicator: 'C10' } }, null],
    ['card B7 (also focus_area / thing_to_try in the corpus)', a37([row('B7')]), null, { indicator: 'B7', action: 'Use the Taleemabad plan' }],
    ['card C10, no rows at all (C10 is outside the 26)', { framework: 'fico', domains: {} }, null, { indicator: 'C10', action: 'Use the tablet' }],
    ['unscored B7 still no_move (before the unscored rule)', a37([row('B7', null)]), { target: { indicator: 'B7' } }, null],
  ])('%s → none hole:no_move, alias_kind no_move', (_, analysis, nextStep, card) => {
    const t = T.pick(analysis, nextStep, card, cat, { subject: 'urdu' });
    expect(t).toMatchObject({ none: 'hole:no_move', aliasKind: 'no_move' });
    const list = S.build(cat, t, ctx, 'x', L, { action: 'use the plan', tryTomorrow: '', thingToTry: '', name: '' });
    expect(list.candidates).toEqual([]);
    expect(list.noneReason).toBe('hole:no_move');
  });

  test('v4-scheme B7 (closure, another meaning) is NOT a no-move', () => {
    const v4 = { framework: 'fico', domains: { B: { indicators: [row('B7')] } } };
    expect(T.pick(v4, { target: { indicator: 'B7' } }, null, cat).none).not.toBe('hole:no_move');
  });

  test('card_text (c\', no indicator) is unaffected', () => {
    const t = T.pick(a37([row('B7')]), null, { action: 'Use the plan, then ask why' }, cat);
    expect(t.source).toBe('card_text');
    expect(t.none).toBeNull();
  });

  test('the other labels stay on the step-text route: unscored F5 is not no_move', () => {
    const t = T.pick(a37([row('F5', null, { applicable: false })]), { target: { indicator: 'F5' } }, null, cat, { subject: 'maths' });
    expect(t.none).toBe('unscored_step');
  });
});
