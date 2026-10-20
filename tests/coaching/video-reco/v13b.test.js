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
  test('PROMPT_VERSION is vr-4', () => expect(P.PROMPT_VERSION).toBe('vr-4'));

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
  test('the rollback drops exactly those two columns', () => {
    expect(down()).toMatch(/DROP COLUMN IF EXISTS attempts/i);
    expect(down()).toMatch(/DROP COLUMN IF EXISTS first_none_reason/i);
  });
});
