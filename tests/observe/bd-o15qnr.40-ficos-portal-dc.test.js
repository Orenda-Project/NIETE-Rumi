'use strict';
/**
 * bd-o15qnr.40.4 / .40.5 (queue #229, the operator 23 Nov ~15:40-15:45) — the FICO-S (grades 6-12) Feedback Form on the
 * portal:
 *
 *   (4) "Rumi is appearing in 6-12. It should be Digital Coach." Every line the portal shows about the AI's pre-fill names
 *       it the Digital Coach (ڈیجیٹل کوچ), as the grades 1-5 form does; never "Rumi" or "NIETE Teaching Assistant".
 *       Portal only: the WhatsApp Flow's screen data keeps its own words (WhatsApp /observe is being turned off).
 *   (5) "'Rumi chose 4' is not evident enough. It should show that on the option itself." The item field carries the
 *       Digital Coach's level (`dcLevel`: '1'..'4' | 'NA'), so the portal marks it on that level's card, as v6 does; the
 *       "chose N" line is tagged `dc: 'chose'` (the v7 portal hides it; the card says it). A "could not set a level" line
 *       is tagged `dc: 'none'` and stays.
 */

const FF = require('../../bot/shared/services/observe/obs612/fico-s-flow');

const DC = {
  levels: {
    C1: { result: 3, because: 'Two open questions.', evidence: [{ time: '04:30', quote: 'Why seven?' }] },
    C2: { result: 'NA', because: 'No group work planned.', evidence: [] },
    C4: { result: 'IE', because: 'Hard to hear.', evidence: [] },
    E3: { result: 2, because: 'Starred.', evidence: [] },
  },
};
const RUBRIC = 'fico_s_v1_2';
const secsOf = (lang, dc = DC) => FF.portalSections({}, lang, { dc, rubric: RUBRIC });
const screenOf = (secs, code) => secs.find((s) => s.parts.some((p) => p.type === 'field' && p.name === code));
const itemOf = (secs, code) => screenOf(secs, code).parts.find((p) => p.type === 'field' && p.name === code);
const linesOf = (secs, code) => screenOf(secs, code).parts.filter((p) => p.type === 'sub' || p.type === 'heading').map((p) => p.text);
const allText = (secs) => JSON.stringify(secs);

describe('FICO-S portal: the Digital Coach\'s level on the item field (dcLevel)', () => {
  test('a level it set: dcLevel is that option\'s id', () => {
    const secs = secsOf('en');
    expect(itemOf(secs, 'C1').dcLevel).toBe('3');
    expect(itemOf(secs, 'C1').options.map((o) => o.id)).toContain('3');
  });

  test('N/A it set: dcLevel NA (the N/A card)', () => {
    expect(itemOf(secsOf('en'), 'C2').dcLevel).toBe('NA');
  });

  test('could not tell, a starred indicator, or no Digital Coach visit: no dcLevel', () => {
    const secs = secsOf('en');
    expect(itemOf(secs, 'C4')).not.toHaveProperty('dcLevel');
    expect(itemOf(secs, 'E3')).not.toHaveProperty('dcLevel');
    expect(itemOf(secs, 'C5')).not.toHaveProperty('dcLevel');
    for (const p of secsOf('en', null).flatMap((s) => s.parts)) expect(p).not.toHaveProperty('dcLevel');
  });
});

describe('FICO-S portal: the pre-fill lines are tagged and name the Digital Coach', () => {
  test('a level it set: its line is tagged dc "chose"; could not set one: tagged dc "none"', () => {
    const secs = secsOf('en');
    const subs = (code) => screenOf(secs, code).parts.filter((p) => p.type === 'sub');
    expect(subs('C1').filter((p) => p.dc === 'chose')).toHaveLength(1);
    expect(subs('C4').filter((p) => p.dc === 'none')).toHaveLength(1);
    expect(subs('C4').find((p) => p.dc === 'none').text).toMatch(/^The Digital Coach could not set a level/);
  });

  test('English: Digital Coach everywhere, never Rumi or NIETE Teaching Assistant', () => {
    const text = allText(secsOf('en'));
    expect(text).toMatch(/Digital Coach/);
    expect(text).not.toMatch(/NIETE Teaching Assistant|\bRumi\b/);
    expect(linesOf(secsOf('en'), 'E3').join(' ')).toMatch(/Digital Coach never scores this one/);
  });

  test('Urdu: ڈیجیٹل کوچ everywhere, never ٹیچنگ اسسٹنٹ or رومی', () => {
    const text = allText(secsOf('ur'));
    expect(text).toMatch(/ڈیجیٹل کوچ/);
    expect(text).not.toMatch(/ٹیچنگ اسسٹنٹ|رومی|NIETE/);
  });

  test('the WhatsApp Flow\'s screen data keeps its own words (portal only)', () => {
    const c1 = JSON.stringify(FF.screenData(FF.indicatorScreenId('C1'), {}, 'en', { dc: DC, rubric: RUBRIC }));
    // the Flow's own line (whatever this branch words it: "Rumi chose" on staging/main, "The NIETE Teaching Assistant
    // chose" on sandbox), never the portal's
    expect(c1).toContain(FF.STR.en.rumi_chose('3').split(' 3 ')[0]);
    expect(c1).not.toMatch(/The Digital Coach chose/);
  });
});

/*
 * bd-o15qnr.40.4 (1b) — staging and production still word the Flow's change-reason help "Only if you changed Rumi's
 * level", and the portal's "Why you changed" box took it as its label. The portal's label has its own words (p_help_chg),
 * whatever the Flow says; the Flow's help is left as it is.
 */
describe('FICO-S portal: the change-reason label has the portal\'s own words', () => {
  test('English and Urdu: the chg_ field text is lbl_chg + the portal help, never the Flow\'s help', () => {
    for (const lang of ['en', 'ur']) {
      const chgField = screenOf(secsOf(lang), 'C1').parts.find((p) => p.type === 'field' && p.name === 'chg_C1');
      const s = FF.STR[lang];
      expect(s.p_help_chg).toBeTruthy();
      expect(chgField.text).toBe(`${s.lbl_chg}: ${s.p_help_chg}`);
      expect(s.p_help_chg).not.toMatch(/Rumi|رومی|NIETE|ٹیچنگ اسسٹنٹ/);
    }
  });
});
