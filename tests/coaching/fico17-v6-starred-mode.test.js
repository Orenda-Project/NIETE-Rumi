'use strict';
/**
 * Queue #184 — FICO17 v6's starred indicators (operator 19 Nov ~14:15: "yeah those six are the starred ones. hitl only
 * are the starred ones basically"; rule, ~11:20: "Starred indicators are the one that do not get sent to DC and are
 * mandatorily filled by the HITL"). In STARRED MODE the six (C3 C5 C7 D2 D3 D4) are never sent to the Digital Coach:
 * not in the prompt (no evidence part), not in the reply or the stored analysis (no combined_evidence, no D2 count),
 * and the coach's review says each is the coach's alone. The coach still sets them, with a reason, as today.
 *
 * Behind app_settings.fico_v6_starred (per user: the observer of a HITL visit, the teacher of a self-recording), OFF by
 * default (operator: "dont turn them on until we are done with our evals"). Off: v6 exactly as before.
 */
jest.mock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn(), logWarn: jest.fn(), logError: jest.fn() }));
let mockSettings = {};
jest.mock('../../bot/shared/config/supabase', () => ({
  from: (table) => {
    const q = { _key: null };
    q.select = () => q;
    q.eq = (c, v) => { if (c === 'key') q._keys = [v]; return q; };
    q.in = (c, v) => { if (c === 'key') q._keys = v; return q; };
    q.maybeSingle = async () => ({ data: null, error: null });
    q.then = (res, rej) => Promise.resolve({ data: table === 'app_settings' ? (q._keys || []).filter((k) => mockSettings[k] !== undefined).map((k) => ({ key: k, value: mockSettings[k] })) : [], error: null }).then(res, rej);
    return q;
  },
}));

const V6 = require('../../bot/shared/services/coaching/frameworks/fico17-v6');
const fw = require('../../bot/shared/services/coaching/frameworks/fico17-v6-framework');
const O6 = require('../../bot/shared/services/observe/observe-fico17-v6');
const Switch = require('../../bot/shared/services/coaching/fico-rubric-switch');

const SIX = ['C3', 'C5', 'C7', 'D2', 'D3', 'D4'];
const T = '[00:10] Teacher (en): Ali, what do you think?\n[00:15] Student (en): Five.\n[30:00] Student (en): I agree.';
const reply = () => {
  const levels = {};
  for (const c of V6.DC_CODES) levels[c] = { result: 2, because: 'x', evidence: [{ time: '00:10', quote: 'Ali, what do you think?' }] };
  return { levels };
};

describe('the starred prompt: the six are not sent', () => {
  const sv = fw.starredVariant();
  const p = sv.getSystemPrompt();
  test('no evidence part, no combined_evidence, no block for any of the six; the 11 are all there', () => {
    expect(p).not.toMatch(/PART 2/);
    expect(p).not.toContain('combined_evidence');
    for (const c of SIX) {
      expect(p).not.toContain(`### Evidence: ${c} `);
      expect(p).not.toContain(`### Indicator: ${c} `);
      expect(p).not.toContain(`"${c}"`);
    }
    for (const c of V6.DC_CODES) expect(p).toContain(`### Indicator: ${c} `);
  });
  test('its own prompt version; the same name, so every v6 reader treats it as v6', () => {
    expect(sv.promptVersion).toMatch(/^fico17-v6-dc-1s\+[0-9a-f]{8}$/);
    expect(sv.name).toBe('fico17_v6');
  });
  test('the default prompt is unchanged: it still asks evidence for the five', () => {
    expect(fw.getSystemPrompt()).toContain('### Evidence: C3 ');
    expect(fw.getSystemPrompt()).toContain('PART 2');
  });
});

describe('the starred validator and scorer: nothing for the six is kept', () => {
  const sv = fw.starredVariant();
  test('a reply with the 11 levels and no combined_evidence passes', () => {
    expect(sv.validate(reply(), T)).toMatchObject({ ok: true });
  });
  test('a reply that brings evidence or a level for one of the six is refused', () => {
    const r = reply();
    r.combined_evidence = { C3: { result: null, items: [] } };
    expect(sv.validate(r, T).errors.join('\n')).toMatch(/C3: starred/);
    const r2 = reply();
    r2.levels.D4 = { result: 3, because: 'x', evidence: [] };
    expect(sv.validate(r2, T).ok).toBe(false);
  });
  test('the stored analysis has no combined_evidence and no D2 count, names the starred six, and adds up the 11', () => {
    const r = reply();
    r.combined_evidence = { C3: { result: null, items: [{ time: '00:10', quote: 'x' }] }, D2: { student_turns_first_half: 3 } };
    const a = sv.computeScores(r, false, T);
    expect(a.combined_evidence).toBeUndefined();
    expect(a.starred).toEqual(SIX);
    expect(a.prompt_version).toBe(sv.promptVersion);
    for (const c of SIX) expect(a.levels[c]).toBeUndefined();
    expect(a.scores.counted).toBe(V6.DC_CODES.length);
    const rows = Object.values(a.domains).flatMap((d) => d.indicators).filter((x) => SIX.includes(x.id));
    expect(rows.every((x) => x.evidence === '' && x.score === null)).toBe(true);
  });
});

describe('the coach\'s review in starred mode: each of the six is the coach\'s alone', () => {
  const a = { ...fw.starredVariant().computeScores(reply(), false), framework: 'fico17_v6' };
  test('the Flow screen\'s "From the recording" says so (en, ur)', () => {
    const { observeStrings } = require('../../bot/shared/services/observe/observe-strings');
    expect(O6.recordingText(a, 'C3', 'en', observeStrings('en'))).toMatch(/^★ /);
    expect(O6.recordingText(a, 'D2', 'en', observeStrings('en'))).toMatch(/^★ /);
    expect(O6.recordingText(a, 'C3', 'ur', observeStrings('ur'))).toMatch(/^★ /);
    // an analysis from before starred mode: as before
    expect(O6.recordingText({ combined_evidence: {} }, 'C3', 'en', observeStrings('en'))).toBe(observeStrings('en').v6f_rec_nothing);
  });
  test('the portal\'s block says so', () => {
    expect(O6.combinedBody(a, 'C5')).toMatch(/★ /);
  });
});

describe('the switch: app_settings.fico_v6_starred, per user, OFF by default', () => {
  beforeEach(() => { Switch._resetCache(); mockSettings = {}; });
  const session = { framework: 'fico17_v6', framework_selection_reason: 'coach_rubric_switch', observation_type: 'leader_observation', observer_user_id: 'coach-1', user_id: 'teacher-1' };
  test('off (no row): a v6 visit is analysed with today\'s v6', async () => {
    const f = await O6.v6FrameworkFor(session);
    expect(f.promptVersion).toBe(fw.promptVersion);
  });
  test('on for the observer: the starred variant', async () => {
    mockSettings = { fico_v6_starred: JSON.stringify({ 'user:coach-1': 'on' }) };
    const f = await O6.v6FrameworkFor(session);
    expect(f.promptVersion).toMatch(/^fico17-v6-dc-1s\+/);
  });
  test('on for someone else: today\'s v6', async () => {
    mockSettings = { fico_v6_starred: JSON.stringify({ 'user:coach-2': 'on' }) };
    expect((await O6.v6FrameworkFor(session)).promptVersion).toBe(fw.promptVersion);
  });
});
