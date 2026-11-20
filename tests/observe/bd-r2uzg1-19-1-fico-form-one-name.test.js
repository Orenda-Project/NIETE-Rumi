'use strict';

/**
 * bd-r2uzg1.19.1 (ICT sheet, HITL rows 196-197): school heads observe with the same FICO forms as coaches, and the
 * forms called the assistant "Rumi" while the rest of WhatsApp calls it the NIETE Teaching Assistant. Heads asked for
 * one name. Every FICO form surface a head or coach sees now says "NIETE Teaching Assistant" / "NIETE ٹیچنگ اسسٹنٹ"
 * where a sentence needs a subject, and no name at all in short helper and error lines; never "Rumi" / "رومی".
 *
 *   v6 Flow     the FICO17 v6 review Flow's screen data (intro note, the pre-filled level's line, helper texts,
 *               starred line, the "you changed a level" refusal), English and Urdu
 *   FICO-S      the FICO 6-12 (FICO-S) Flow's screen data and the portal's FICO-S form parts, English and Urdu
 *   obs612      the message that brings the pre-filled FICO 6-12 form (body ≤ 1024)
 *   around      every string in the /observe catalog (the "report waiting for a tap" line included), the pre-visit
 *               brief card's first-visit line
 *   source      no string literal in these files names Rumi (comments and log lines aside)
 *
 * Out of scope here, reported instead: /observe2's evidence check ("Rumi's levels", "Add one Rumi missed") is static
 * text in a published Meta Flow, so changing it needs a Flow re-publish.
 */

process.env.OBSERVE_FRAMEWORK = 'fico';
process.env.OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY || 'test-key';
process.env.OPENAI_API_KEY = process.env.OPENAI_API_KEY || 'test-key';

jest.mock('../../bot/shared/config/supabase', () => ({ from: jest.fn(() => { throw new Error('no database in this test'); }) }));
jest.mock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn() }));
jest.mock('../../bot/shared/services/whatsapp.service', () => ({
  sendFlow: jest.fn(() => Promise.resolve(true)),
  sendMessage: jest.fn(() => Promise.resolve(true)),
  sendInteractiveButtons: jest.fn(() => Promise.resolve(true)),
}));

const fs = require('fs');
const path = require('path');

const v6 = require('../../bot/shared/services/coaching/frameworks/fico17-v6');
const O6 = require('../../bot/shared/services/observe/observe-fico17-v6');
const FicoS = require('../../bot/shared/services/coaching/frameworks/fico-s');
const FS = require('../../bot/shared/services/observe/obs612/fico-s-flow');
const { obs612Strings } = require('../../bot/shared/services/observe/obs612/strings');
const { observeStrings } = require('../../bot/shared/services/observe/observe-strings');
const { BRIEF_STRINGS } = require('../../bot/shared/services/observe/observe-brief-card');

// Latin, Urdu (Farsi yeh) and Arabic (Arabic yeh) spellings of the template name.
const RUMI = /\bRumi\b|رومی|رومي/i;
const NAME = { en: /NIETE Teaching Assistant/, ur: /NIETE⁩? ٹیچنگ اسسٹنٹ/ };
const cp = (s) => Array.from(String(s)).length;
const texts = (o) => {
  if (typeof o === 'string') return [o];
  if (Array.isArray(o)) return o.flatMap(texts);
  if (o && typeof o === 'object') return Object.values(o).flatMap(texts);
  return [];
};
const withRumi = (o) => texts(o).filter((t) => RUMI.test(t));

// ── v6 (FICO17 v6, grades 1-5): the review Flow ─────────────────────────────

/** A made-up DC reply: every DC indicator at level 2, C2 N/A, D5 couldn't tell; C3 starred. No name in its words. */
function v6Analysis() {
  const levels = {};
  v6.DC_CODES.forEach((c) => { levels[c] = { result: 2, because: `The teacher did ${c} twice.`, evidence: [{ time: '03:10', quote: 'Why is that?' }] }; });
  levels.C2 = { result: 'NA', because: 'No wrong answer was heard.' };
  levels.D5 = { result: 'IE', because: 'Student lines were unclear.' };
  const domains = {};
  Object.values(v6.SECTIONS).forEach((s) => {
    domains[s.domain] = { indicators: s.codes.map((c) => ({ id: c, score: v6.isDc(c) ? 2 : null, result: v6.isDc(c) ? (levels[c] || {}).result : null })) };
  });
  return {
    framework: 'fico17_v6', rubric: 'fico17_v6', prompt_version: 'fico17-v6-dc-1+test', levels, domains, starred: ['C5'],
    combined_evidence: { C3: { result: null, items: [{ time: '05:10', quote: 'What do you think?' }] }, D2: { student_turns_first_half: 30, student_turns_second_half: 12 } },
  };
}

const screenOfCode = (code) => O6.screenOf(code);

describe.each(['en', 'ur'])('v6 review Flow (%s)', (lang) => {
  const analysis = v6Analysis();
  const dcCode = v6.DC_CODES.find((c) => !['C2', 'D5'].includes(c));

  test('no screen of the form says Rumi', () => {
    const offenders = [];
    for (const id of O6.SCREENS.filter((s) => s !== 'DOMAIN_B')) {
      const data = O6.screenData(analysis, id, { lang });
      withRumi(data).forEach((t) => offenders.push(`${id}: ${t}`));
    }
    expect(offenders).toEqual([]);
  });

  test('the intro and the pre-filled level name the NIETE Teaching Assistant', () => {
    const intro = O6.screenData(analysis, `INTRO_${dcCode[0]}`, { lang });
    expect(intro.note).toMatch(NAME[lang]);
    expect(O6.screenData(analysis, screenOfCode(dcCode), { lang }).rumi_note).toMatch(NAME[lang]);
    expect(O6.screenData(analysis, screenOfCode('D5'), { lang }).rumi_note).toMatch(NAME[lang]); // no level set
    expect(O6.screenData(analysis, screenOfCode('C2'), { lang }).rumi_note).toMatch(NAME[lang]); // N/A chosen
  });

  test('helper texts stay within Meta\'s 80 and carry no name', () => {
    const d = O6.screenData(analysis, screenOfCode(dcCode), { lang });
    for (const k of ['help_ev', 'help_chg']) {
      expect(cp(d[k])).toBeLessThanOrEqual(80);
      expect(d[k]).not.toMatch(RUMI);
    }
  });

  test('a starred indicator says it is the observer\'s alone, without Rumi', () => {
    const d = O6.screenData(analysis, screenOfCode('C5'), { lang });
    expect(d.evidence).toMatch(/★/);
    expect(d.evidence).not.toMatch(RUMI);
  });

  test('changing a pre-filled level without a reason: the refusal says no Rumi', () => {
    const id = screenOfCode(dcCode);
    const errors = O6.validateScreen(id, { [`r_${dcCode}`]: '4', [`chg_${dcCode}`]: 'no' }, analysis, O6.messages(lang));
    expect(Object.keys(errors)).toContain(`chg_${dcCode}`);
    expect(withRumi(errors)).toEqual([]);
    expect(withRumi(O6.screenData(analysis, id, { lang, errors }))).toEqual([]);
  });

  // main has no per-indicator N/A table (fico17_v6.na.json, sandbox/staging only): C2's N/A line is v6f_rumi_chose,
  // checked above.
});

test('v6: the English fallback refusal and the old 5-screen Flow\'s starred line say no Rumi', () => {
  expect(O6.MSG_EN.v6_change_why).not.toMatch(RUMI);
  expect(O6.combinedBody(v6Analysis(), 'C5')).not.toMatch(RUMI);
});

// ── FICO-S (FICO 6-12): the Flow and the portal form ───────────────────────

/** A made-up FICO-S DC reply: level 3 everywhere, C2 N/A, D1 couldn't tell (with a reason), D2 couldn't tell. */
function ficoSDc() {
  const levels = {};
  for (const c of FicoS.DC_CODES) levels[c] = { result: 3, because: `The teacher did ${c}.`, evidence: [] };
  levels.C2 = { result: 'NA', because: 'No answer was wrong.' };
  levels.D1 = { result: 'IE', because: 'student answers were unclear' };
  levels.D2 = { result: 'IE', because: '' };
  return { levels, prompt_version: 'fico-s-dc-1+test' };
}

describe.each(['en', 'ur'])('FICO-S 6-12 form (%s)', (lang) => {
  const dc = ficoSDc();
  const indicators = FS.SCREENS.filter((s) => s.kind === 'indicator');

  test('no Flow screen says Rumi', () => {
    const offenders = [];
    for (const s of FS.SCREENS) withRumi(FS.screenData(s.id, {}, lang, { dc })).forEach((t) => offenders.push(`${s.id}: ${t}`));
    expect(offenders).toEqual([]);
  });

  test('the pre-filled line and the starred line name the NIETE Teaching Assistant; the change helper ≤ 80, no name', () => {
    const lines = indicators.map((s) => FS.screenData(s.id, {}, lang, { dc })).filter((d) => d.rumi_v).map((d) => d.rumi_line);
    expect(lines.length).toBeGreaterThan(3);
    lines.forEach((l) => expect(l).toMatch(NAME[lang]));
    const star = indicators.map((s) => FS.screenData(s.id, {}, lang, { dc })).find((d) => d.star_v);
    expect(star.star_line).toMatch(NAME[lang]);
    const any = FS.screenData(indicators[0].id, {}, lang, { dc });
    expect(cp(any.help_chg)).toBeLessThanOrEqual(80);
    expect(any.help_chg).not.toMatch(RUMI);
  });

  test('the "you changed a level" refusal says no Rumi', () => {
    const s = indicators.find((x) => FS.screenData(x.id, {}, lang, { dc }).chg_v);
    const field = FS.fieldsOf(s.id).find((f) => f.check === 'change');
    const d = FS.screenData(s.id, {}, lang, { dc, errors: { [field.name]: 'change' } });
    expect(d.error_messages[field.name]).toBeTruthy();
    expect(withRumi(d.error_messages)).toEqual([]);
  });

  test('the portal\'s FICO-S form parts say no Rumi', () => {
    expect(withRumi(FS.portalSections({}, lang, { dc }))).toEqual([]);
  });
});

// ── obs612: the message that brings the pre-filled FICO 6-12 form ──────────

test.each(['en', 'ur'])('the pre-filled FICO 6-12 form message names the NIETE Teaching Assistant, ≤ 1024 (%s)', (lang) => {
  const body = obs612Strings(lang, { ficoS: true }).form_body_dc(7, 'Science', FicoS.STARRED_CODES.slice());
  expect(body).not.toMatch(RUMI);
  expect(body).toMatch(NAME[lang]);
  expect(cp(body)).toBeLessThanOrEqual(1024);
});

// ── Around the form ─────────────────────────────────────────────────────────

test.each(['en', 'ur', 'sw'])('no /observe catalog string says Rumi (%s)', (lang) => {
  const S = observeStrings(lang);
  const offenders = Object.entries(S).filter(([, v]) => typeof v === 'string' && RUMI.test(v)).map(([k, v]) => `${k}: ${v}`);
  expect(offenders).toEqual([]);
});

test('the pre-visit brief card\'s first-visit line says no Rumi in any language', () => {
  expect(withRumi(BRIEF_STRINGS.first_visit)).toEqual([]);
});

// ── Source: no string literal names Rumi in the FICO form files ────────────

test('no string literal in the FICO form files names Rumi (comments and log lines aside)', () => {
  const ROOT = path.resolve(__dirname, '../..');
  const files = [
    'bot/shared/services/observe/observe-strings.js',
    'bot/shared/services/observe/observe-fico17-v6.js',
    'bot/shared/services/observe/obs612/fico-s-flow.js',
    'bot/shared/services/observe/obs612/strings.js',
    'bot/shared/services/observe/observe-brief-card.js',
  ];
  const offenders = [];
  for (const rel of files) {
    fs.readFileSync(path.join(ROOT, rel), 'utf8').split('\n').forEach((line, i) => {
      const t = line.trim();
      if (t.startsWith('//') || t.startsWith('*') || t.startsWith('/*')) return;
      if (/logToFile|logger\./.test(line)) return;
      if (/['"`][^'"`]*(?:\bRumi\b|رومی|رومي)/.test(line)) offenders.push(`${rel}:${i + 1}`);
    });
  }
  expect(offenders).toEqual([]);
});
