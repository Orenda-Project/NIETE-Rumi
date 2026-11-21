'use strict';

/**
 * FICO-S v1.2 (queue #218; lists approved 21 Nov, "Approve both, notes included", then "Go ahead"). The same 23
 * indicators and level text as v1.1 (frozen), plus:
 *   - N/A only on C2 ("N/A · No answer was wrong", was the generic "N/A · did not happen") and C3 (new,
 *     "N/A · No question asked", arrives chosen when the observer set C1 to level 1), each with its own words, en + ur;
 *   - a "Couldn't tell" (IE) line per indicator for the Digital Coach (IE stays the Digital Coach's only);
 *   - two scoring notes, C5 and A3;
 *   - the stamp: a new form is 'fico_s_v1_2', shown as 'FICO 6-12 v1.2'. A v1.1 form keeps v1.1 (its text, its N/A,
 *     its label 'FICO 6-12') and finishes on it.
 * Scores and reports leave N/A (and the Digital Coach's IE) out of every total.
 */

jest.mock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn() }));

const FicoS = require('../../bot/shared/services/coaching/frameworks/fico-s');
const FS = require('../../bot/shared/services/observe/obs612/fico-s-flow');
const fw = require('../../bot/shared/services/coaching/frameworks/fico-s-framework');
const O = require('../../bot/shared/services/coaching/frameworks/obs612');
const Record = require('../../bot/shared/services/observe/obs612/record');
const Summary = require('../../bot/shared/services/observe/obs612/summary');
const View = require('../../bot/shared/services/observe/obs612/view');
const FsDc = require('../../bot/shared/services/observe/obs612/fico-s-dc');
const own = require('../../bot/shared/services/coaching/frameworks/own-rubric');
const { rubricLabelOf } = require('../../bot/shared/services/coaching/rubric-label');

const V11 = 'fico_s_v1_1';
const V12 = 'fico_s_v1_2';
const cps = (s) => Array.from(String(s || '')).length;

describe('the rubric: two versions, one text', () => {
  test('a new form is v1.2; both ids are FICO-S; each has its own label', () => {
    expect(FicoS.RUBRIC_KEY).toBe(V12);
    expect(FicoS.IDS).toEqual([V11, V12]);
    expect(FicoS.isFicoSId(V11)).toBe(true);
    expect(FicoS.isFicoSId(V12)).toBe(true);
    expect(FicoS.isFicoSId('fico_s_v1_3')).toBe(false);
    expect(FicoS.labelOf(V11)).toBe('FICO 6-12');
    expect(FicoS.labelOf(V12)).toBe('FICO 6-12 v1.2');
    expect(FicoS.LABEL).toBe('FICO 6-12 v1.2');
    expect(FicoS.versionOf(V11)).toBe('1.1');
    expect(FicoS.versionOf(V12)).toBe('1.2');
  });

  test('N/A: v1.1 on C2 only, v1.2 on C2 and C3 only', () => {
    expect(FicoS.naCodes(V11)).toEqual(['C2']);
    expect(FicoS.naCodes(V12)).toEqual(['C2', 'C3']);
    expect(FicoS.NA_CODES).toEqual(['C2', 'C3']);
    expect(FicoS.normLevel('NA', 'C3', V12)).toBe('NA');
    expect(FicoS.normLevel('NA', 'C3', V11)).toBeNull();
    expect(FicoS.normLevel('NA', 'C4', V12)).toBeNull();
  });

  test('the level text is the same in both versions, word for word', () => {
    for (const c of FicoS.CODES) {
      for (const lang of ['en', 'ur']) {
        expect(FicoS.indicatorText(c, lang, V12).levels).toEqual(FicoS.indicatorText(c, lang, V11).levels);
        expect(FicoS.indicatorText(c, lang, V12).name).toBe(FicoS.indicatorText(c, lang, V11).name);
      }
    }
  });

  test("each N/A has its own words, en + ur, within WhatsApp's limits", () => {
    const c2 = FicoS.naOption('C2', 'en', V12);
    expect(c2).toEqual(expect.objectContaining({ id: 'NA', title: 'N/A · No answer was wrong' }));
    expect(FicoS.naOption('C2', 'ur', V12).title).toBe('لاگو نہیں · کوئی جواب غلط نہیں');
    expect(FicoS.naOption('C3', 'en', V12).title).toBe('N/A · No question asked');
    expect(FicoS.naOption('C3', 'ur', V12).title).toBe('لاگو نہیں · کوئی سوال نہیں');
    expect(FicoS.naSentence('C2', 'en', V12)).toBe('No answer was wrong in this lesson.');
    expect(FicoS.naSentence('C3', 'en', V12)).toBe('The teacher asked the students no question to answer.');
    for (const code of ['C2', 'C3']) for (const lang of ['en', 'ur']) {
      const o = FicoS.naOption(code, lang, V12);
      expect(cps(o.title)).toBeLessThanOrEqual(30);
      expect(cps(o.description)).toBeLessThanOrEqual(300);
    }
    expect(FicoS.naOption('C4', 'en', V12)).toBeNull();
    // v1.1 is frozen: C2's generic title, no C3.
    expect(FicoS.naOption('C2', 'en', V11).title).toBe('N/A · did not happen');
    expect(FicoS.naOption('C3', 'en', V11)).toBeNull();
  });

  test('C3 follows C1 = 1 (v1.2 only), with a note naming C1', () => {
    expect(FicoS.naFollows('C3', V12)).toEqual({ code: 'C1', level: 1 });
    expect(FicoS.naFollows('C3', V11)).toBeNull();
    expect(FicoS.naFollowNote('C3', 'en', V12)).toMatch(/C1/);
    expect(FicoS.naFollowNote('C3', 'ur', V12)).toMatch(/C1/);
  });

  test('the C5 and A3 scoring notes (v1.2 only), en + ur', () => {
    expect(FicoS.noteOf('C5', 'en', V12)).toBe('If the class never changes activity, score the start and the time lost only.');
    expect(FicoS.noteOf('A3', 'en', V12)).toBe('If the homework schedule sets no homework for this subject today, score the closure only.');
    expect(FicoS.noteOf('C5', 'ur', V12)).toMatch(/سرگرمی/);
    expect(FicoS.noteOf('A3', 'ur', V12)).toMatch(/ہوم ورک/);
    expect(FicoS.noteOf('C5', 'en', V11)).toBeNull();
    expect(FicoS.noteOf('C4', 'en', V12)).toBeNull();
  });

  test('a "Couldn\'t tell" line for every indicator the Digital Coach is asked (22), none for starred E3', () => {
    for (const c of FicoS.DC_CODES) expect(FicoS.ieLine(c, V12)).toEqual(expect.any(String));
    expect(FicoS.DC_CODES).toHaveLength(22);
    expect(FicoS.ieLine('E3', V12)).toBeNull();
  });

  test('scores leave N/A out of both sides; IE never counts', () => {
    const levels = Object.fromEntries(FicoS.CODES.map((c) => [c, 3]));
    levels.C2 = 'NA';
    levels.C3 = 'NA';
    const r = FicoS.score(levels, V12);
    expect(r.rubric).toBe(V12);
    expect(r.na).toEqual(['C2', 'C3']);
    expect(r.counted).toBe(21);
    expect(r.max).toBe(84);
    expect(r.pct).toBe(75);
    // On a v1.1 form, C3 N/A is not a level: it is missing, never scored.
    const old = FicoS.score(levels, V11);
    expect(old.na).toEqual(['C2']);
    expect(old.missing).toContain('C3');
    levels.C4 = 'IE';
    expect(FicoS.score(levels, V12).counted).toBe(20);
  });
});

describe('the observer form (WhatsApp Flow and portal: the same endpoint data)', () => {
  const lvOpts = (code, lang, id) => FS.screenData(FS.SCREENS.find((s) => s.code === code).id, {}, lang, { rubric: id }).opts;

  test('C2 and C3 offer N/A last, in their own words (en + ur); no other indicator does', () => {
    const c2 = lvOpts('C2', 'en', V12);
    expect(c2.map((o) => o.id)).toEqual(['1', '2', '3', '4', 'NA']);
    expect(c2[4].title).toBe('N/A · No answer was wrong');
    expect(lvOpts('C2', 'ur', V12)[4].title).toBe('لاگو نہیں · کوئی جواب غلط نہیں');
    const c3 = lvOpts('C3', 'en', V12);
    expect(c3[4]).toEqual(expect.objectContaining({ id: 'NA', title: 'N/A · No question asked' }));
    expect(lvOpts('C3', 'ur', V12)[4].title).toBe('لاگو نہیں · کوئی سوال نہیں');
    for (const c of FicoS.CODES.filter((x) => !['C2', 'C3'].includes(x))) {
      expect(lvOpts(c, 'en', V12).map((o) => o.id)).toEqual(['1', '2', '3', '4']);
    }
  });

  test('a v1.1 form keeps v1.1: C2 generic, no C3 N/A, label FICO 6-12', () => {
    expect(lvOpts('C2', 'en', V11)[4].title).toBe('N/A · did not happen');
    expect(lvOpts('C3', 'en', V11).map((o) => o.id)).toEqual(['1', '2', '3', '4']);
    expect(FS.screenData('FS_START', {}, 'en', { rubric: V11 }).rubric_label).toBe('FICO 6-12');
    expect(FS.screenData('FS_START', {}, 'en', { rubric: V12 }).rubric_label).toBe('FICO 6-12 v1.2');
  });

  test('C3 arrives on N/A when the observer set C1 to 1, with the note; not above 1; not on v1.1; own choice wins', () => {
    const scr = FS.SCREENS.find((s) => s.code === 'C3').id;
    const d = FS.screenData(scr, { C1: '1' }, 'en', { rubric: V12 });
    expect(d.init.lv_C3).toBe('NA');
    expect(d.look_for).toMatch(/C1/);
    expect(FS.screenData(scr, { C1: '2' }, 'en', { rubric: V12 }).init.lv_C3).toBe('');
    expect(FS.screenData(scr, { C1: '1' }, 'en', { rubric: V11 }).init.lv_C3).toBe('');
    expect(FS.screenData(scr, { C1: '1', C3: '2' }, 'en', { rubric: V12 }).init.lv_C3).toBe('2');
  });

  test('C5 and A3 show their scoring note (v1.2), on WhatsApp and on the portal', () => {
    for (const code of ['C5', 'A3']) {
      const scr = FS.SCREENS.find((s) => s.code === code).id;
      expect(FS.screenData(scr, {}, 'en', { rubric: V12 }).look_for).toContain(FicoS.noteOf(code, 'en', V12));
      expect(FS.screenData(scr, {}, 'ur', { rubric: V12 }).look_for).toContain(FicoS.noteOf(code, 'ur', V12));
      expect(FS.screenData(scr, {}, 'en', { rubric: V11 }).look_for).not.toContain('score the');
      const portal = FS.portalSections({}, 'en', { rubric: V12 }).flatMap((s) => s.parts).find((p) => p.type === 'field' && p.name === code);
      expect(portal.text).toContain(FicoS.noteOf(code, 'en', V12));
    }
  });

  test('the check accepts C3 N/A on v1.2 and refuses it on v1.1', () => {
    const scr = FS.SCREENS.find((s) => s.code === 'C3').id;
    const ev = 'No question was put to the class all period.';
    expect(FS.checkScreen(scr, { C3: 'NA', ev_C3: ev }, { rubric: V12 })).toEqual({});
    expect(FS.checkScreen(scr, { C3: 'NA', ev_C3: ev }, { rubric: V11 })).toEqual({ lv_C3: 'item' });
  });

  test("the portal's options carry the same N/A words, and C3 tells the portal it follows C1 = 1 (v1.2 only)", () => {
    const f = FS.portalFields('en', { rubric: V12 }).find((x) => x.name === 'C3');
    expect(f.options.map((o) => o.title)).toContain('N/A · No question asked');
    const part = (id) => FS.portalSections({}, 'en', { rubric: id }).flatMap((s) => s.parts).find((p) => p.type === 'field' && p.name === 'C3');
    expect(part(V12).follows).toEqual({ code: 'C1', level: '1' });
    expect(part(V11).follows).toBeUndefined();
  });

  test("Rumi's N/A on C3 reads in C3's own words", () => {
    const scr = FS.SCREENS.find((s) => s.code === 'C3').id;
    const dc = { levels: { C3: { result: 'NA', because: 'no question', evidence: [] } } };
    const d = FS.screenData(scr, {}, 'en', { rubric: V12, dc });
    expect(d.rumi_line).toMatch(/N\/A · No question asked/);
    expect(d.init.lv_C3).toBe('');
    expect(FsDc.rumiLevelOf(dc, 'C3', V12)).toBe('NA');
    expect(FsDc.rumiLevelOf(dc, 'C3', V11)).toBeNull();
  });
});

describe('the Digital Coach (dc-4)', () => {
  const prompt = fw.getSystemPrompt();

  test('prompt version dc-4, rubric v1.2', () => {
    expect(fw.promptVersion).toMatch(/^fico-s-dc-4\+[0-9a-f]{8}$/);
    expect(fw.rubric).toBe(V12);
    expect(prompt).toContain(`"rubric": "${V12}"`);
  });

  test("every asked indicator carries its own Couldn't tell line; E3 is never in the prompt", () => {
    for (const c of FicoS.DC_CODES) expect(prompt).toContain(`Couldn't tell ("IE") when: ${FicoS.ieLine(c, V12)}`);
    expect(prompt).not.toMatch(/### Indicator: E3/);
  });

  test('N/A lines on C2 and C3 only; the schema allows NA only there', () => {
    expect(prompt).toContain(`N/A when: ${FicoS.naDcRule('C2', V12)}`);
    expect(prompt).toContain(`N/A when: ${FicoS.naDcRule('C3', V12)}`);
    expect((prompt.match(/N\/A when:/g) || []).length).toBe(2);
    expect(prompt).toMatch(/"NA" only for C2, C3/);
  });

  function reply(over = {}) {
    const levels = {};
    for (const c of FicoS.DC_CODES) levels[c] = { result: 2, because: 'seen', evidence: [] };
    Object.assign(levels, over);
    return { rubric: V12, levels };
  }

  test('the validator takes N/A on C3, refuses it elsewhere; the scorer stamps v1.2 and leaves N/A and IE out', () => {
    expect(fw.validate(reply({ C3: { result: 'NA', because: 'no question', evidence: [] } }), '').ok).toBe(true);
    const bad = fw.validate(reply({ C4: { result: 'NA', because: 'x', evidence: [] } }), '');
    expect(bad.ok).toBe(false);
    expect(bad.errors.join(' ')).toMatch(/C4/);
    const a = fw.computeScores(reply({ C2: { result: 'NA', because: 'x', evidence: [] }, C3: { result: 'NA', because: 'x', evidence: [] }, C4: { result: 'IE', because: 'x', evidence: [] } }));
    expect(a.rubric).toBe(V12);
    expect(a.levels.C3.result).toBe('NA');
    expect(a.dc_scores.counted).toBe(19);
    expect(a.dc_scores.rubric).toBe(V12);
  });
});

describe('every reader knows both ids', () => {
  test('the obs612 registry: a new FICO-S lesson is v1.2; both ids are the ficos tool with their own label', () => {
    expect(O.toolFor(7, 'maths', { ficoS: true }).rubricId).toBe(V12);
    for (const id of [V11, V12]) {
      expect(O.isObs612Id(id)).toBe(true);
      expect(O.toolOf(id)).toBe('ficos');
      expect(O.toolById(id)).toEqual(expect.objectContaining({ id }));
    }
    expect(O.labelOf(V11)).toBe('FICO 6-12');
    expect(O.labelOf(V12)).toBe('FICO 6-12 v1.2');
  });

  test('a score on either is a rubric of its own (never in a FICO total), and a FICO-S score', () => {
    for (const id of [V11, V12]) {
      expect(own.isOwnRubric({ rubric: id })).toBe(true);
      expect(own.isFicoSScored({ framework: id })).toBe(true);
      expect(own.isObs612Scored({ scores: { rubric: id } })).toBe(true);
    }
  });

  test('the dashboard keeps both out of FICO averages too', () => {
    const D = require('../../dashboard/services/coaching-frameworks.service');
    const isOwn = D.isOwnRubric;
    expect(typeof isOwn).toBe('function');
    expect(isOwn({ rubric: V12 })).toBe(true);
    expect(isOwn({ rubric: V11 })).toBe(true);
  });

  test('the rubric label: FICO 6-12 v1.2 for a new form, FICO 6-12 for v1.1', () => {
    expect(rubricLabelOf({ form: { rubric_version: V12 } })).toEqual({ id: V12, label: 'FICO 6-12 v1.2' });
    expect(rubricLabelOf({ form: { rubric_version: V11 } })).toEqual({ id: V11, label: 'FICO 6-12' });
  });

  test('a Digital Coach visit on either id is a DC visit, analysed on its own key', () => {
    for (const id of [V11, V12]) expect(FsDc.isDcVisit({ framework: id, framework_selection_reason: FsDc.REASON })).toBe(true);
    const reg = require('../../bot/shared/services/coaching/frameworks/framework-registry');
    expect(reg.getFramework(V12).rubric).toBe(V12);
  });
});

describe('the record, the coach summary and the view of a v1.2 visit', () => {
  const answersFor = (screenId) => {
    const s = FS.screenById(screenId);
    const out = {};
    for (const f of s.fields) {
      if (f.check === 'level') out[f.name] = ['C2', 'C3'].includes(f.code) ? 'NA' : '3';
      else if (f.check === 'evidence') out[f.name] = `Saw it in the room for ${f.key}, clearly.`;
      else if (f.check === 'yes_no') out[f.name] = 'yes';
      else if (f.name === 'fs_focus') out[f.name] = 'C4';
      else if (f.name === 'fs_focus_2' || f.name === 'fs_action_2') out[f.name] = '';
      else out[f.name] = f.required ? `Words for ${f.name}` : '';
    }
    return out;
  };
  const draft = () => {
    const d = {};
    for (const s of FS.SCREENS) Object.assign(d, FS.mergeDraft({}, s.id, answersFor(s.id)));
    return d;
  };
  const analysis = (id = V12) => Record.buildAnalysis({
    id: 'f1', rubric_version: id, observer_user_id: 'c1', teacher_user_id: 't1', visit_context: { grade: 7, subject: 'maths', via: 'observe' },
  }, draft());

  test('the record keeps C2 and C3 N/A out of the score and is stamped v1.2', () => {
    const a = analysis();
    expect(a.rubric).toBe(V12);
    expect(a.rubric_label).toBe('FICO 6-12 v1.2');
    expect(a.obs612.answers.C3).toBe('NA');
    expect(a.obs612.result.na).toEqual(['C2', 'C3']);
    expect(a.obs612.result.counted).toBe(21);
    expect(a.obs612.result.pct).toBe(75);
  });

  test("the coach summary names each N/A in its own words (en + ur), not 'N/A: C2'", () => {
    const en = Summary.buildCoachSummary(analysis(), { lang: 'en', teacherName: 'Rabia' });
    expect(en).toMatch(/N\/A: C2 No answer was wrong in this lesson\.?/);
    expect(en).toMatch(/C3 The teacher asked the students no question to answer/);
    expect(en).toMatch(/FICO 6-12 v1\.2/);
    const ur = Summary.buildCoachSummary(analysis(), { lang: 'ur', teacherName: 'Rabia' });
    expect(ur).toMatch(/اس سبق میں کوئی جواب غلط نہیں تھا/);
  });

  test("the portal's view row says the N/A in its own words, no number", () => {
    const s = View.portalSummary(analysis());
    const row = s.rows.find((r) => /^C3 · /.test(r.name));
    expect(row.value).toBe('N/A · No question asked');
    expect(row.pct).toBeNull();
  });
});
