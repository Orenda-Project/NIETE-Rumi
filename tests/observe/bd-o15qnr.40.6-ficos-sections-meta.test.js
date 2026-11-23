'use strict';
/**
 * bd-o15qnr.40.6 (queue #229, the operator 23 Nov ~15:50: "why is 6-12 so different looking than the 1-5 one? Can they be
 * the same?") — the FICO-S Feedback Form on the portal draws as the 1-5 form does: its sections as rows, a section's
 * indicators as rows, one indicator alone. The bot says what each portal section is (additive; parts unchanged):
 *
 *   kind      start | intro | indicator | checklist | feedback
 *   sec       the rubric's section key (A..E) on an intro and an indicator
 *   title     the section's name on an intro (the observer's language)
 *   code, name, starred   on an indicator
 */
const FF = require('../../bot/shared/services/observe/obs612/fico-s-flow');

const RUBRIC = 'fico_s_v1_2';
const DC = { levels: { A1: { result: 3, because: 'Clear.', evidence: [] } } };

describe('FICO-S portal sections carry what they are', () => {
  const secs = FF.portalSections({}, 'en', { dc: DC, rubric: RUBRIC });

  test('every section has a kind; the order is start, then each intro and its indicators, checklist, feedback', () => {
    expect(secs.every((s) => ['start', 'intro', 'indicator', 'checklist', 'feedback'].includes(s.kind))).toBe(true);
    expect(secs[0].kind).toBe('start');
    expect(secs[secs.length - 2].kind).toBe('checklist');
    expect(secs[secs.length - 1].kind).toBe('feedback');
  });

  test('an intro: its section key and name', () => {
    const a = secs.find((s) => s.id === 'FS_INTRO_A');
    expect(a).toMatchObject({ kind: 'intro', sec: 'A', title: 'Lesson planning & structure' });
  });

  test('an indicator: its section key, code, name and starred', () => {
    const one = secs.find((s) => s.kind === 'indicator' && s.code === 'A1');
    expect(one).toMatchObject({ kind: 'indicator', sec: 'A', code: 'A1', starred: false });
    expect(typeof one.name).toBe('string');
    expect(one.name.length).toBeGreaterThan(3);
    const starred = secs.filter((s) => s.kind === 'indicator' && s.starred).map((s) => s.code);
    expect(starred.length).toBeGreaterThan(0);
    expect(secs.filter((s) => s.kind === 'indicator')).toHaveLength(23);
  });

  test('starred only on a Digital Coach visit (as the star line)', () => {
    const plain = FF.portalSections({}, 'en', { rubric: RUBRIC });
    expect(plain.filter((s) => s.kind === 'indicator' && s.starred)).toHaveLength(0);
  });

  test('Urdu: the section name and the indicator name in Urdu', () => {
    const ur = FF.portalSections({}, 'ur', { dc: DC, rubric: RUBRIC });
    expect(ur.find((s) => s.id === 'FS_INTRO_A').title).toMatch(/[؀-ۿ]/);
    expect(ur.find((s) => s.code === 'A1').name).toMatch(/[؀-ۿ]/);
  });

  test('the parts are unchanged by it (ids and part types as before)', () => {
    for (const s of secs) expect(Array.isArray(s.parts)).toBe(true);
    expect(secs.find((s) => s.code === 'A1').parts.map((p) => p.type)).toEqual(expect.arrayContaining(['heading', 'field']));
  });
});
