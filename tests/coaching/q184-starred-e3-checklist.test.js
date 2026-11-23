'use strict';

/**
 * Queue #184, 19 Nov afternoon (operator, via Godfather).
 *
 * 1. Starred (bd-pkxzg9.2): "thats wrong. those are not starred." Read from the sources: the FICO-S v1.1 sheet marks
 *    no indicator (no star or HITL column, no note, no format); FICO17 v6's source has a scored_by column whose
 *    "HITL only" six (C3 C5 C7 D2 D3 D4) are its COMBINED indicators, not starred. So: FICO 6-12 starred = E3 only
 *    (the operator's word); FICO17 v6 starred = none, the six go to the Digital Coach as before (evidence only, 11 Nov).
 * 2. The checklist (bd-pkxzg9.3): "the checklist section is not optional." FS_CHECKLIST's 12 Yes/No checks are
 *    required: the observer stays on the screen with a line under each one not answered (as the 20-character evidence
 *    rule does), in English and Urdu, and Submit refuses while any is missing.
 */

const FicoS = require('../../bot/shared/services/coaching/frameworks/fico-s');
const V6 = require('../../bot/shared/services/coaching/frameworks/fico17-v6');
const fw = require('../../bot/shared/services/coaching/frameworks/fico-s-framework');
const FS = require('../../bot/shared/services/observe/obs612/fico-s-flow');
const { obs612Strings } = require('../../bot/shared/services/observe/obs612/strings');
const { render } = require('../../bot/scripts/generate-fico-s-flow-json');

const NOW_DC = ['C3', 'C5', 'C7', 'D2', 'D3', 'E2'];
const CHECKS = FicoS.RUBRIC.checklist.map((c) => c.key);
const T = '[00:10] Teacher (en): Write the objective in your notebook.\n[00:20] Student (en): Yes.';
const reply = (over = {}) => {
  const levels = {};
  for (const c of FicoS.DC_CODES) levels[c] = { result: c === 'C2' ? 'NA' : 2, because: 'x', evidence: [] };
  return { levels: { ...levels, ...over } };
};

/** A draft with every indicator, evidence and feedback field answered, and no checklist. */
function draftWithoutChecklist() {
  const d = {};
  for (const c of FicoS.CODES) { d[c] = c === 'C2' ? 'NA' : '3'; d[`ev_${c}`] = `Saw it in the room for ${c}, clearly.`; }
  return { ...d, fb_strengths: 'Clear objective and good questions.', fs_focus: 'C4', fs_action: 'Ask three students to explain.' };
}

describe('starred, as the sources mark it (operator 19 Nov: the six are not starred)', () => {
  test('FICO 6-12 stars E3 only', () => {
    expect(FicoS.STARRED_CODES).toEqual(['E3']);
    expect(FicoS.RUBRIC.indicators.filter((i) => i.starred).map((i) => i.code)).toEqual(['E3']);
  });

  test('the Digital Coach is asked the other 22, the six included', () => {
    expect(FicoS.DC_CODES).toHaveLength(22);
    expect(FicoS.DC_CODES).not.toContain('E3');
    for (const c of NOW_DC) expect(FicoS.DC_CODES).toContain(c);
    const p = fw.getSystemPrompt();
    for (const c of NOW_DC) expect(p).toContain(FicoS.indicatorText(c, 'en').name);
    expect(p).not.toContain(FicoS.indicatorText('E3', 'en').name);
  });

  test('a reply must score the six now; E3 is still refused', () => {
    const { C3, ...noC3 } = reply().levels;
    expect(fw.validate({ levels: noC3 }, T).ok).toBe(false);
    expect(fw.validate(reply(), T).ok).toBe(true);
    expect(fw.validate(reply({ E3: { result: 2, because: 'x', evidence: [] } }), T).errors.join('\n')).toMatch(/E3: a starred indicator/);
  });

  test('FICO17 v6 stars none; its six stay combined (evidence only, as 11 Nov)', () => {
    expect(V6.STARRED_CODES).toEqual([]);
    expect(V6.RUBRIC.indicators.filter((i) => i.starred).map((i) => i.code)).toEqual([]);
    expect(V6.RUBRIC.indicators.filter((i) => i.kind === 'combined').map((i) => i.code)).toEqual(['C3', 'C5', 'C7', 'D2', 'D3', 'D4']);
  });

  test('the pre-filled form names E3 alone', () => {
    for (const lang of ['en', 'ur']) {
      const body = obs612Strings(lang, { ficoS: true }).form_body_dc(7, 'Science', FicoS.STARRED_CODES);
      expect(body).toMatch(/E3/);
      for (const c of NOW_DC) expect(body).not.toMatch(new RegExp(`\\b${c}\\b`));
    }
  });

  test('the six get the change-reason box on a Digital Coach visit; E3 does not', () => {
    for (const c of NOW_DC) expect(FS.fieldsOf(FS.indicatorScreenId(c)).map((f) => f.name)).toContain(`chg_${c}`);
    expect(FS.fieldsOf(FS.indicatorScreenId('E3')).map((f) => f.name)).not.toContain('chg_E3');
  });
});

describe('the checklist is required (operator 19 Nov: "not optional")', () => {
  test('all 12 checks are required', () => {
    const fields = FS.fieldsOf('FS_CHECKLIST');
    expect(fields.map((f) => f.name)).toEqual(CHECKS);
    expect(CHECKS).toHaveLength(12);
    expect(fields.every((f) => f.required)).toBe(true);
  });

  test('Next with checks unanswered: each one missing gets its own line', () => {
    const errors = FS.checkScreen('FS_CHECKLIST', { cl_1: 'yes', cl_2: 'no' });
    expect(Object.keys(errors).sort()).toEqual(CHECKS.slice(2).sort());
    expect(new Set(Object.values(errors))).toEqual(new Set(['yes_no']));
    expect(FS.checkScreen('FS_CHECKLIST', Object.fromEntries(CHECKS.map((k, i) => [k, i % 2 ? 'no' : 'yes'])))).toEqual({});
  });

  test('the line under a missing check, in English and Urdu', () => {
    const errors = FS.checkScreen('FS_CHECKLIST', {});
    expect(FS.screenData('FS_CHECKLIST', {}, 'en', { errors }).error_messages.cl_1).toBe('Choose Yes or No.');
    expect(FS.screenData('FS_CHECKLIST', {}, 'ur', { errors }).error_messages.cl_1).toBe('ہاں یا نہیں چنیں۔');
  });

  test('Submit refuses without the checklist and names the checks, Urdu digits in Urdu', () => {
    const missing = FS.whatIsMissing(draftWithoutChecklist());
    expect(missing).toEqual(CHECKS);
    expect(FS.missingNote(missing, 'en')).toMatch(/Checklist 1; Checklist 2; Checklist 3 and 9 more/);
    expect(FS.missingNote(missing, 'ur')).toMatch(/چیک لسٹ ۱/);
    expect(FS.missingNote(missing, 'ur')).not.toMatch(/[0-9]/);
    const full = { ...draftWithoutChecklist(), ...Object.fromEntries(CHECKS.map((k) => [k, 'yes'])) };
    expect(FS.whatIsMissing(full)).toEqual([]);
  });

  test('the Flow marks every check required, and the portal shows it so', () => {
    const flow = JSON.parse(render());
    const screen = flow.screens.find((s) => s.id === 'FS_CHECKLIST');
    const radios = [];
    const walk = (n) => {
      if (Array.isArray(n)) n.forEach(walk);
      else if (n && typeof n === 'object') { if (n.type === 'RadioButtonsGroup') radios.push(n); Object.values(n).forEach(walk); }
    };
    walk(screen.layout);
    expect(radios.map((r) => r.name)).toEqual(CHECKS);
    for (const r of radios) expect(r.required).toBe(true);
    for (const f of FS.portalFields('en').filter((x) => CHECKS.includes(x.name))) expect(f.required).toBe(true);
  });

  test('the screen says the checks are required, within the caps', () => {
    for (const lang of ['en', 'ur']) {
      const d = FS.screenData('FS_CHECKLIST', {}, lang);
      expect(d.note).toMatch(lang === 'en' ? /every/i : /لازمی/);
      expect(Array.from(d.note).length).toBeLessThanOrEqual(300);
    }
  });
});
