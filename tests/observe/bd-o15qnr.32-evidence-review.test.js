'use strict';
/**
 * bd-o15qnr.32 — v7 Feedback Form, evidence option B (#204, locked by #188 21 Nov ~10:05), the server side.
 *
 * The draft view (getDraft) of a FICO17 v6 visit sends, on each of Rumi's 11 (kind 'dc'):
 *   rumiEvidence    { because, items: [{ time, quote }] }: Rumi's structured output for the indicator, every quote in
 *                   full and in order (analysis.levels[code], else the row's evidence_items / rumi_evidence_items);
 *                   null when there is nothing.
 *   evidenceReview  the coach's saved review of that evidence (row.evidence_review), or null.
 * Every field the view sent before stays exactly as it was (the `evidence` string included).
 *
 * The save accepts an optional `evidence_review` { [code]: { summary: {rumi, coach}, items: [...] } }, checked
 * strictly (a bad shape is dropped and never breaks the save of `edits`), and the review writes it beside the row as
 * row.evidence_review. ev_<code> is unchanged: the report, the debrief guide and WhatsApp read that text as today.
 * A request without evidence_review behaves exactly as before.
 */

const SVC = '../../bot/shared/services/observe/portal-observe.service';
const O = require('../../bot/shared/services/observe/observe-fico17-v6');
const v6 = require('../../bot/shared/services/coaching/frameworks/fico17-v6');

const COACH = 'c0ac0000-0000-4000-8000-000000000001';
const TEACHER_UID = '7eac0000-0000-4000-8000-000000000003';
const SID = 'cs-v6-ev';
const WHY = 'Called Ali and Sana by name before asking, twice.';
const LONG_QUOTE = `Children, look at the board. ${'Who can tell me what comes after seven, and why do you think so? '.repeat(3)}Ali?`;

function fakeSupabase(answer = {}) {
  const from = (table) => {
    const q = { filters: {} };
    const self = new Proxy(q, {
      get(target, prop) {
        if (prop in target) return target[prop];
        if (prop === 'eq') return (c, v) => { target.filters[c] = v; return self; };
        if (prop === 'single' || prop === 'maybeSingle') {
          return async () => {
            const fn = answer[table];
            return { data: typeof fn === 'function' ? fn(target.filters) : (fn ?? null), error: null };
          };
        }
        return () => self;
      },
    });
    return self;
  };
  return { from };
}

/** A v6 analysis as the v6 DC scorer leaves it (computeScores' rows), C1 with two quotes, the first a long one. */
function v6Analysis(over = {}) {
  const levels = {};
  const domains = { v6_teacher: { indicators: [] }, v6_children: { indicators: [] }, v6_subject: { indicators: [] } };
  for (const code of v6.CODES) {
    const row = { id: code, name: v6.indicator(code).name };
    if (v6.isDc(code)) {
      const evidence = code === 'C1'
        ? [{ time: '03:10', quote: LONG_QUOTE }, { time: '07:45', quote: 'Sana, why seven?' }]
        : [{ time: '03:10', quote: `Quote for ${code}` }];
      levels[code] = { result: 3, because: `Rumi saw ${code} twice.`, evidence };
      Object.assign(row, {
        kind: 'dc', set_by: 'dc', result: 3, score: 3, because: `Rumi saw ${code} twice.`,
        evidence: evidence.map((i) => `[${i.time}] "${i.quote}"`).join(' '), evidence_items: evidence,
        evidence_summary: `Rumi saw ${code} twice. [${evidence[0].time}] "${evidence[0].quote}"`, improvement: `Next for ${code}`,
      });
    }
    domains[v6.DOMAIN_OF[code]].indicators.push(row);
  }
  return {
    framework: 'fico17_v6', rubric: 'fico17_v6', levels, domains,
    combined_evidence: { C3: { result: null, items: [{ time: '05:00', quote: 'Ali, what do you think?' }] }, D2: { student_turns_first_half: 4, student_turns_second_half: 7 } },
    lp_fidelity: null,
    ...over,
  };
}

function obsRow(over = {}) {
  return {
    id: SID, user_id: TEACHER_UID, observer_user_id: COACH, observation_type: 'leader_observation',
    audio_url: 'https://r2.example/bucket/classroom_audio/x/wa.ogg', status: 'awaiting_observer_review', debrief_status: 'pending',
    framework: 'fico17_v6', created_at: '2026-11-21T04:30:00Z', analysis_data: v6Analysis(), ...over,
  };
}

function deps(row) {
  return {
    supabase: fakeSupabase({ users: () => ({ id: COACH, role: 'coach', phone_number: '923000000000', preferred_language: 'en' }), coaching_sessions: () => row }),
    draft: {
      buildScreenPrefill: jest.fn((a, key) => (key === 'lesson_plan_fidelity'
        ? { has_fidelity: false, no_fidelity: true, fid_header: '', fid_fallback: 'No lesson plan was provided.', mv_1: '', mv_1_v: false, fr_1: 'not_adjudicable', fe_1: '' }
        : {})),
      applyObserverEdits: jest.fn().mockResolvedValue({ indicators_rescored: 0, text_fields_changed: 0 }),
      FIDELITY_VERDICT_OPTIONS: [{ id: 'executed', title: '✓ Executed' }],
      MAX_MOVE_SLOTS: 1,
      fid: (id) => String(id).replace(/\./g, '_'),
    },
    pack: () => ({
      domainOrder: ['lesson_plan_fidelity'],
      domains: { lesson_plan_fidelity: { key: 'B', title: 'Lesson Plan Fidelity', indicators: [] } },
      scaleOptions: [],
    }),
    languageFor: jest.fn().mockResolvedValue('en'),
    state: { getState: jest.fn().mockResolvedValue(null), clearState: jest.fn() },
    observationNotes: { notesOf: () => [], REVIEW_KEY: 'observation_notes_review_opened_at', markReviewOpened: jest.fn() },
    notesOn: jest.fn().mockResolvedValue(false),
    debrief: { buildDebriefGuide: jest.fn(), mergeObserverDebrief: jest.fn() },
    log: jest.fn(),
    now: () => new Date('2026-11-21T05:00:00Z'),
  };
}

/** Every field the v6 form sends, valid: the six set with reasons, Rumi's 11 kept. */
function validEdits(over = {}) {
  const e = {};
  for (const code of v6.CODES) {
    if (v6.isCombined(code)) { e[`r_${code}`] = '3'; e[`why_${code}`] = WHY; } else { e[`r_${code}`] = '3'; e[`ev_${code}`] = `Rumi saw ${code} twice.`; e[`imp_${code}`] = `Next for ${code}`; }
  }
  e.chg_C = ''; e.chg_D = ''; e.chg_F = '';
  return { ...e, ...over };
}

/** A review as the v7 form sends it for C1: summary edited, one quote kept, one edited, one removed, one line added. */
function c1Review() {
  return {
    summary: { rumi: 'Rumi saw C1 twice.', coach: 'Two open questions, both to named children.' },
    items: [
      { source: 'rumi', time: '03:10', quote: LONG_QUOTE, status: 'kept' },
      { source: 'rumi', time: '07:45', quote: 'Sana, why seven?', status: 'edited', coach_text: 'Sana, why is it seven?' },
      { source: 'rumi', time: '09:00', quote: 'Sit down please.', status: 'removed' },
      { source: 'coach', time: '12:30', text: 'She waited five seconds before taking an answer.' },
      { source: 'coach', text: 'Board work was clear from the back row.' },
    ],
  };
}

const ind = (out, code) => out.sections.flatMap((s) => s.indicators || []).find((i) => i.id === code);
const EXISTING_DC_KEYS = ['id', 'field', 'name', 'options', 'kind', 'rumi', 'rating', 'evidence', 'improvement'];

let Svc;
beforeEach(() => { jest.resetModules(); Svc = require(SVC); });

// ── The view ────────────────────────────────────────────────────────────────

describe('getDraft — each of Rumi\'s 11 carries Rumi\'s structured evidence and the saved review', () => {
  test('rumiEvidence from levels: the because line and every quote, in full and in order; no review yet', async () => {
    const out = await Svc.getDraft({ userId: COACH, coachingSessionId: SID }, deps(obsRow()));
    const c1 = ind(out, 'C1');
    expect(c1.rumiEvidence).toEqual({
      because: 'Rumi saw C1 twice.',
      items: [{ time: '03:10', quote: LONG_QUOTE }, { time: '07:45', quote: 'Sana, why seven?' }],
    });
    expect(LONG_QUOTE.length).toBeGreaterThan(120); // no 120-letter cut on the structured list
    expect(c1.evidenceReview).toBeNull();
    expect(ind(out, 'F1').rumiEvidence).toEqual({ because: 'Rumi saw F1 twice.', items: [{ time: '03:10', quote: 'Quote for F1' }] });
  });

  test('additive only: every field sent before is still there, the evidence string exactly as before', async () => {
    const out = await Svc.getDraft({ userId: COACH, coachingSessionId: SID }, deps(obsRow()));
    const c1 = ind(out, 'C1');
    expect(Object.keys(c1).filter((k) => k !== 'rumiEvidence' && k !== 'evidenceReview')).toEqual(EXISTING_DC_KEYS);
    // Today's ev_ prefill: the because line and only the FIRST quote, clipped (rumiEvidenceText).
    expect(c1.evidence.startsWith('Rumi saw C1 twice. · 03:10 "Children, look at the board.')).toBe(true);
    expect(c1.evidence).not.toContain('Sana, why seven?');
    expect(c1.evidence.endsWith('…"')).toBe(true);
  });

  test('the six combined indicators get neither field', async () => {
    const out = await Svc.getDraft({ userId: COACH, coachingSessionId: SID }, deps(obsRow()));
    for (const code of v6.COMBINED_CODES) {
      expect(ind(out, code)).not.toHaveProperty('rumiEvidence');
      expect(ind(out, code)).not.toHaveProperty('evidenceReview');
    }
  });

  test('levels without the indicator: the row\'s evidence_items and because (before a review)', async () => {
    const a = v6Analysis();
    delete a.levels.C1;
    const out = await Svc.getDraft({ userId: COACH, coachingSessionId: SID }, deps(obsRow({ analysis_data: a })));
    expect(ind(out, 'C1').rumiEvidence).toEqual({
      because: 'Rumi saw C1 twice.',
      items: [{ time: '03:10', quote: LONG_QUOTE }, { time: '07:45', quote: 'Sana, why seven?' }],
    });
  });

  test('after a review: the row\'s rumi_evidence_items (Rumi\'s list, moved there by the review); a coach-set row\'s because is hers, so not Rumi\'s', async () => {
    const a = v6Analysis();
    const edits = validEdits({ r_C1: '2', chg_C: 'Only one open question was asked, not two.', ev_C1: 'One open question at 03:10.' });
    O.applyReview(a, O.buildReview(a, edits), edits, v6Analysis());
    const row = a.domains.v6_teacher.indicators.find((i) => i.id === 'C1');
    expect(row.evidence_items).toBeUndefined();
    expect(row.rumi_evidence_items).toHaveLength(2);
    delete a.levels.C1;
    const out = await Svc.getDraft({ userId: COACH, coachingSessionId: SID }, deps(obsRow({ status: 'observer_review_complete', analysis_data: a })));
    expect(ind(out, 'C1').rumiEvidence).toEqual({
      because: null,
      items: [{ time: '03:10', quote: LONG_QUOTE }, { time: '07:45', quote: 'Sana, why seven?' }],
    });
  });

  test('nothing from Rumi: rumiEvidence is null', async () => {
    const a = v6Analysis();
    delete a.levels.C1;
    const row = a.domains.v6_teacher.indicators.find((i) => i.id === 'C1');
    row.evidence_items = [];
    row.because = '';
    const out = await Svc.getDraft({ userId: COACH, coachingSessionId: SID }, deps(obsRow({ analysis_data: a })));
    expect(ind(out, 'C1').rumiEvidence).toBeNull();
  });

  test('a saved review comes back on its indicator, with her draft edits', async () => {
    const a = v6Analysis();
    const edits = validEdits({ ev_C1: 'Two open questions, both to named children. 03:10 "Children, look…"' });
    O.applyReview(a, O.buildReview(a, edits), { ...edits, evidence_review: { C1: c1Review() } }, v6Analysis());
    const out = await Svc.getDraft({ userId: COACH, coachingSessionId: SID }, deps(obsRow({ status: 'observer_review_complete', analysis_data: a })));
    expect(ind(out, 'C1').evidenceReview).toEqual({
      summary: { rumi: 'Rumi saw C1 twice.', coach: 'Two open questions, both to named children.' },
      items: [
        { source: 'rumi', time: '03:10', quote: LONG_QUOTE, status: 'kept' },
        { source: 'rumi', time: '07:45', quote: 'Sana, why seven?', status: 'edited', coach_text: 'Sana, why is it seven?' },
        { source: 'rumi', time: '09:00', quote: 'Sit down please.', status: 'removed' },
        { source: 'coach', time: '12:30', text: 'She waited five seconds before taking an answer.' },
        { source: 'coach', time: null, text: 'Board work was clear from the back row.' },
      ],
    });
    expect(ind(out, 'C1').evidence).toBe(edits.ev_C1); // her ev_ text, as today
    expect(ind(out, 'C2').evidenceReview).toBeNull();
    // Rumi's own list is still Rumi's after the save.
    expect(ind(out, 'C1').rumiEvidence.items).toHaveLength(2);
  });
});

// ── The check ───────────────────────────────────────────────────────────────

describe('sanitizeEvidenceReview — strict: known DC codes, strings only, caps, the status enum', () => {
  test('a valid review passes as the stored shape (coach time null when absent)', () => {
    const out = O.sanitizeEvidenceReview({ C1: c1Review() });
    expect(Object.keys(out)).toEqual(['C1']);
    expect(out.C1.items[4]).toEqual({ source: 'coach', time: null, text: 'Board work was clear from the back row.' });
  });

  test.each([
    ['undefined', undefined], ['null', null], ['a string', '{"C1":{}}'], ['an array', [c1Review()]], ['a number', 7],
    ['only unknown codes', { Z9: c1Review() }], ['a combined code', { C3: c1Review() }], ['a non-object entry', { C1: 'kept' }],
    ['an entry with nothing in it', { C1: { summary: { rumi: 5, coach: [] }, items: 'x' } }],
  ])('%s → null', (_label, input) => {
    expect(O.sanitizeEvidenceReview(input)).toBeNull();
  });

  test('bad items are dropped one by one; extra keys go; the rest stay in order', () => {
    const r = c1Review();
    r.items = [
      { source: 'rumi', time: '03:10', quote: 'kept one', status: 'kept', junk: 1, coach_text: 'ignored when not edited' },
      { source: 'rumi', time: '03:11', quote: 'bad status', status: 'deleted' },
      { source: 'rumi', time: '03:12', quote: '', status: 'kept' },
      { source: 'rumi', time: '03:13', quote: 42, status: 'kept' },
      { source: 'rumi', time: '03:14', quote: 'edited without text', status: 'edited' },
      { source: 'coach', text: '   ' },
      { source: 'coach', text: { html: '<b>' } },
      { source: 'ai', text: 'unknown source' },
      null, 'line', 9,
      { source: 'coach', time: 190, text: 'a time that is not a string is dropped, the line stays' },
      { source: 'coach', time: 'yesterday', text: 'a time that is not mm:ss is dropped too' },
      { source: 'rumi', time: null, quote: 'no time', status: 'removed' },
    ];
    expect(O.sanitizeEvidenceReview({ C1: r }).C1.items).toEqual([
      { source: 'rumi', time: '03:10', quote: 'kept one', status: 'kept' },
      { source: 'coach', time: null, text: 'a time that is not a string is dropped, the line stays' },
      { source: 'coach', time: null, text: 'a time that is not mm:ss is dropped too' },
      { source: 'rumi', time: null, quote: 'no time', status: 'removed' },
    ]);
  });

  test('at most 30 items per indicator, every text capped', () => {
    const r = { summary: { rumi: 'x'.repeat(5000), coach: 'y'.repeat(5000) }, items: [] };
    for (let i = 0; i < 45; i += 1) r.items.push({ source: 'coach', time: '01:00', text: `line ${i} ${'z'.repeat(5000)}` });
    const out = O.sanitizeEvidenceReview({ C1: r }).C1;
    expect(out.items).toHaveLength(30);
    expect(out.items[0].text.startsWith('line 0 ')).toBe(true);
    const cap = O.EVIDENCE_REVIEW_LIMITS.text;
    expect(out.summary.rumi).toHaveLength(cap);
    expect(out.summary.coach).toHaveLength(cap);
    out.items.forEach((i) => expect(i.text.length).toBeLessThanOrEqual(cap));
  });

  test('a bad summary field is an empty string; known codes are kept beside unknown ones', () => {
    const out = O.sanitizeEvidenceReview({ C1: { summary: { rumi: 'Rumi saw it.', coach: 9 }, items: [] }, Q7: c1Review(), C3: c1Review() });
    expect(out).toEqual({ C1: { summary: { rumi: 'Rumi saw it.', coach: '' }, items: [] } });
  });

  test('never throws, even on a hostile object', () => {
    const evil = {};
    Object.defineProperty(evil, 'C1', { enumerable: true, get() { throw new Error('boom'); } });
    expect(O.sanitizeEvidenceReview(evil)).toBeNull();
  });
});

// ── The save ────────────────────────────────────────────────────────────────

describe('saveDraft — evidence_review rides with the edits to the review\'s own save', () => {
  test('a valid review is passed on (checked) beside the edits', async () => {
    const d = deps(obsRow());
    const edits = validEdits();
    const out = await Svc.saveDraft({ userId: COACH, coachingSessionId: SID, edits, evidenceReview: { C1: c1Review(), Z9: c1Review() } }, d);
    expect(out.status).toBe('ok');
    const sent = d.draft.applyObserverEdits.mock.calls[0][1];
    expect(sent).toEqual({ ...edits, evidence_review: O.sanitizeEvidenceReview({ C1: c1Review() }) });
  });

  test.each([
    ['a string', 'kept everything'], ['an array', [c1Review()]], ['unknown codes only', { Z9: c1Review() }], ['null', null],
  ])('a bad review (%s) is dropped; the edits are saved exactly as without it', async (_label, bad) => {
    const d = deps(obsRow());
    const edits = validEdits();
    const out = await Svc.saveDraft({ userId: COACH, coachingSessionId: SID, edits, evidenceReview: bad }, d);
    expect(out.status).toBe('ok');
    expect(d.draft.applyObserverEdits).toHaveBeenCalledWith(SID, edits);
    expect(d.draft.applyObserverEdits.mock.calls[0][1]).not.toHaveProperty('evidence_review');
  });

  test('without evidence_review the save is exactly today\'s', async () => {
    const d = deps(obsRow());
    const edits = validEdits();
    await Svc.saveDraft({ userId: COACH, coachingSessionId: SID, edits }, d);
    expect(d.draft.applyObserverEdits).toHaveBeenCalledWith(SID, edits);
    expect(Object.keys(d.draft.applyObserverEdits.mock.calls[0][1])).toEqual(Object.keys(edits));
  });

  test('an evidence_review sent INSIDE edits is not a review (edits carry strings only)', async () => {
    const d = deps(obsRow());
    const edits = validEdits();
    await Svc.saveDraft({ userId: COACH, coachingSessionId: SID, edits: { ...edits, evidence_review: { C1: c1Review() } } }, d);
    expect(d.draft.applyObserverEdits).toHaveBeenCalledWith(SID, edits);
  });

  test('a refused review saves nothing, the evidence review included', async () => {
    const d = deps(obsRow());
    const out = await Svc.saveDraft({ userId: COACH, coachingSessionId: SID, edits: validEdits({ r_C3: '' }), evidenceReview: { C1: c1Review() } }, d);
    expect(out.status).toBe('invalid');
    expect(d.draft.applyObserverEdits).not.toHaveBeenCalled();
  });

  test('a V3 visit never carries it', async () => {
    const d = deps(obsRow({ framework: null, analysis_data: { framework: 'fico', domains: {} } }));
    await Svc.saveDraft({ userId: COACH, coachingSessionId: SID, edits: { r_C1: '2' }, evidenceReview: { C1: c1Review() } }, d);
    expect(d.draft.applyObserverEdits).toHaveBeenCalledWith(SID, { r_C1: '2' });
  });
});

describe('applyReview — writes row.evidence_review; ev_ and Rumi\'s list as today', () => {
  const stamp = (a) => { a.fico17_v6_review.reviewed_at = 'T'; return a; };

  test('the review sits beside the row; the row\'s evidence is the ev_ text; Rumi\'s list stays in rumi_evidence_items', () => {
    const a = v6Analysis();
    const edits = validEdits({ ev_C1: 'Two open questions, both to named children.' });
    O.applyReview(a, O.buildReview(a, edits), { ...edits, evidence_review: { C1: c1Review() } }, v6Analysis());
    const row = a.domains.v6_teacher.indicators.find((i) => i.id === 'C1');
    expect(row.evidence_review).toEqual(O.sanitizeEvidenceReview({ C1: c1Review() }).C1);
    expect(row.evidence).toBe('Two open questions, both to named children.');
    expect(row.evidence_sw).toBe('Two open questions, both to named children.');
    expect(row.evidence_summary).toBe('Two open questions, both to named children.');
    expect(row.rumi_evidence_items).toEqual(v6Analysis().levels.C1.evidence);
    expect(a.domains.v6_teacher.indicators.find((i) => i.id === 'C2')).not.toHaveProperty('evidence_review');
  });

  test('with no review, or a bad one, the analysis is exactly what it is today', () => {
    const edits = validEdits({ r_C1: '2', chg_C: 'Only one open question was asked, not two.', ev_C1: 'One open question.' });
    const today = v6Analysis();
    const countsToday = O.applyReview(today, O.buildReview(today, edits), edits, v6Analysis());
    for (const bad of ['all kept', [1], { C3: c1Review() }, { C1: { summary: 1, items: 2 } }, null]) {
      const a = v6Analysis();
      const counts = O.applyReview(a, O.buildReview(a, edits), { ...edits, evidence_review: bad }, v6Analysis());
      expect(stamp(a)).toEqual(stamp(JSON.parse(JSON.stringify(today))));
      expect(counts).toEqual(countsToday);
    }
    expect(JSON.stringify(today)).not.toContain('evidence_review');
  });

  test('a later save without a review leaves an earlier review where it was', () => {
    const a = v6Analysis();
    const edits = validEdits();
    O.applyReview(a, O.buildReview(a, edits), { ...edits, evidence_review: { C1: c1Review() } }, v6Analysis());
    O.applyReview(a, O.buildReview(a, edits), edits, v6Analysis());
    expect(a.domains.v6_teacher.indicators.find((i) => i.id === 'C1').evidence_review).toEqual(O.sanitizeEvidenceReview({ C1: c1Review() }).C1);
  });
});
