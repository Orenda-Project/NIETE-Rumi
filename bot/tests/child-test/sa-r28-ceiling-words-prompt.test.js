'use strict';
/**
 * The staging pick's merge of sa_r28_ceiling (the stack) and sa_r28_words_prompt (#4986) in sa/score.js: both switches
 * ON, read from app_settings by the SWEEP (the merged scoreRow call, hunk 4). An EXTENSION word (past base_n, served
 * only with the ceiling ON) heard as one of its accepted forms is listed with that form in prompt C and credited; the
 * rate uses the time actually used. Only the clip, speech-to-text and the model are stand-ins; every fixture is synthetic.
 */
jest.mock('../../shared/config/supabase', () => ({ from: () => { throw new Error('no db in this test'); } }));
const score = require('../../shared/services/child-test/sa/score');

const pad = (n) => String(n).padStart(2, '0');
const SID = 'eeeeeeee-0000-4000-8000-000000000099';
const WORDS = Array.from({ length: 20 }, (_, k) => `word${k + 1}`);
// the accepted forms ride on the extension items, as the bank's ext_items carry them
const ACCEPT = { 5: ['wurd6'], 7: ['wurd8', 'werd8'] };
function extWords() {
  const all = WORDS.map((w, k) => ({ id: `en.words4.${pad(k + 1)}`, show: w, target: w, answer: w, src: 'synthetic', ...(k >= 4 ? { ext: true } : {}), ...(ACCEPT[k] ? { accept: ACCEPT[k] } : {}) }));
  const items = all.slice(0, 4);
  return { id: 'en.words4', w3: true, kind: 'grid', subtask: 'familiar_word_reading', lang: 'en', response: 'record', present: 'one_at_a_time', time_limit_s: 60, stop: {}, items, grid: items.map((x) => x.show), base_n: 4, ext_items: all.slice(4) };
}
const BATTERY = { tasks: [extWords()] };
const cells = (n) => Array.from({ length: n }, (_, i) => ({ i, item_id: `en.words4.${pad(i + 1)}`, at_ms: i * 5000, ms: 5000, how: 'tap' }));
const session = () => ({ id: SID, grade: 3, form: 'A', item_bank_version: 'sa-battery', status: 'completed', finished_at: '2026-11-17T10:00:00Z' });
const row = () => ({
  id: 'row-en.words4', session_id: SID, block: 'en.words4', response_mode: 'record', ai_status: 'failed', ai_reason: 'final:sa_score_later',
  ai_marks: null, audio_r2_key: `child-test/sandbox/sch-1/${SID}/sa/en.words4.webm`, audio_r2_keys: null, updated_at: '2026-11-17T09:58:00Z', lang: 'en',
  responses: [{ kind: 'result', mode: 'record', session_id: 'phone-session', cells: cells(8), last_item_index: 7, time_used_ms: 40000, stop_reason: 'early_stop_silence' }],
});

// the "model": the child said an accepted form at positions 6 and 8; it credits a position only when the card lists that
// form beside the word ("(also: …)"), as prompt C instructs. Every other reached word is read correctly.
function standIns() {
  const prompts = [];
  return {
    prompts,
    bank: { forms: {}, tasks: {} },
    phoneBattery: () => BATTERY,
    clipOf: async (key) => ({ base64: 'AAAA', durationSec: 40, key }),
    speechOf: async () => ({ words: 8, text: 'x', model: 'stt:test', cost: 0, seconds: 1 }),
    model: () => 'model:test',
    chatJSON: async ({ prompt }) => {
      prompts.push(prompt);
      const lines = prompt.split('\n').filter((l) => /^\d+: /.test(l));
      const said = { 6: 'wurd6', 8: 'werd8' };
      if (!lines.length) return { json: { words: [], words_correct: 0, words_attempted: 0, notes: '' }, cost: 0, seconds: 1 };
      const items = lines.map((l) => {
        const i = Number(l.split(':')[0]);
        const heard = said[i] || `word${i}`;
        const v = i > 8 ? 's' : said[i] ? (l.includes(said[i]) ? 'c' : 'w') : 'c';
        return { i, heard: v === 's' ? '' : heard, v, conf: 0.9 };
      });
      return { json: { found: true, last_attempted: 8, letters_correct: items.filter((x) => x.v === 'c').length, items }, cost: 0, seconds: 1 };
    },
  };
}

function fakeDb(tables) {
  function query(name) {
    const f = []; let patch = null; let lim = null;
    const q = {
      select() { return q; }, order() { return q; }, in() { return q; },
      limit(n) { lim = n; return q; },
      eq(c, v) { f.push((r) => r[c] === v); return q; },
      is(c, v) { f.push((r) => (r[c] ?? null) === v); return q; },
      like(c, v) { const pre = v.replace(/%$/, ''); f.push((r) => String(r[c] || '').startsWith(pre)); return q; },
      gte(c, v) { f.push((r) => String(r[c]) >= v); return q; },
      update(x) { patch = x; return q; },
      then(ok, bad) {
        try {
          const hit = (tables[name] || []).filter((r) => f.every((fn) => fn(r)));
          if (patch) { hit.forEach((r) => Object.assign(r, patch)); return Promise.resolve({ data: hit.map((r) => ({ id: r.id })), error: null }).then(ok, bad); }
          const copy = hit.map((r) => JSON.parse(JSON.stringify(r)));
          return Promise.resolve({ data: lim ? copy.slice(0, lim) : copy, error: null }).then(ok, bad);
        } catch (e) { return Promise.reject(e).then(ok, bad); }
      },
    };
    return q;
  }
  return { from: query };
}

describe('the staging pick: sa_r28_ceiling x sa_r28_words_prompt, both ON from app_settings', () => {
  const before = { ...process.env };
  beforeEach(() => { process.env.CHILD_TEST_SA_SCORER = 'on'; process.env.CHILD_TEST_R2_ENV = 'sandbox'; process.env.CHILD_TEST_SA_SPEECH_GATE = 'on'; score.__internals.resetBoot(); });
  afterEach(() => { process.env = { ...before }; });

  test('an extension word read as its accepted form is listed with it in prompt C and credited; the rate uses the 40 s used', async () => {
    const r = row();
    const s = standIns();
    const db = fakeDb({
      child_test_blocks: [r], child_test_sessions: [session()],
      app_settings: [{ key: 'sa_r28_words_prompt', value: true }, { key: 'sa_r28_ceiling', value: true }],
    });
    const out = await score.sweepOnce({ now: new Date('2026-11-17T10:05:00Z'), deps: { supabase: db, ...s } });
    expect(out).toMatchObject({ found: 1, scored: 1 });
    expect(s.prompts).toHaveLength(1);
    const p = s.prompts[0];
    expect(p).toMatch(/FAMILIAR WORDS/);                         // prompt C, not the passage prompt
    expect(p).toContain('\n6: word6 (also: wurd6)\n');            // an extension item's accepted form reaches the card
    expect(p).toContain('\n8: word8 (also: wurd8, werd8)\n');
    expect(p).not.toMatch(/\n9: /);                               // the 8 reached, never fewer than base_n 4
    const m = r.ai_marks;
    expect(m.detail.items.slice(0, 8).map((i) => i.verdict)).toEqual(Array(8).fill('correct'));
    expect(m.correct).toBe(8);
    expect(m.attempted).toBe(8);
    expect(m.seconds_used).toBe(40);
    expect(m.per_minute).toBe(12);                                 // 8 correct in 40 s
    expect(m.detail).toMatchObject({ of_all: 8, of_base: 4, correct_base: 4 });
  });

  test('the same run without the phone clock: prompt C still, and the rate is pending (the ceiling reached the scorer)', async () => {
    const r = row();
    delete r.responses[0].time_used_ms;
    const s = standIns();
    const db = fakeDb({
      child_test_blocks: [r], child_test_sessions: [session()],
      app_settings: [{ key: 'sa_r28_words_prompt', value: true }, { key: 'sa_r28_ceiling', value: true }],
    });
    await score.sweepOnce({ now: new Date('2026-11-17T10:05:00Z'), deps: { supabase: db, ...s } });
    expect(s.prompts[0]).toContain('\n6: word6 (also: wurd6)\n');
    expect(r.ai_marks.correct).toBe(8);
    expect(r.ai_marks.detail).toMatchObject({ rate_pending: true });
    expect(r.ai_marks.per_minute == null).toBe(true);
  });
});
