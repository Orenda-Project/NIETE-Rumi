'use strict';
/**
 * bd-y4ywxn — the observe copy a NIETE coach or teacher READS is Pakistani, not
 * Tanzanian.
 *
 * NIETE serves ICT and Gilgit-Baltistan only. The /observe product was ported
 * from the Tanzania bot, and three English strings came across with it: the
 * send step's example teacher (*Ms. Zainabu, 0712 345 678*, a Swahili name in
 * the Tanzanian 07xx format), the re-ask ("a Tanzanian phone number"), and the
 * reply a teacher gets for /observe ("school leaders (field officers)", the
 * Tanzania role title). The Urdu set never had them. A coach told to find "a
 * Tanzanian phone number" reads the bot as broken or meant for someone else.
 *
 * The guard reads every value through observeStrings() — the function that
 * serves the copy — never by grepping the source, so a later port from the main
 * bot cannot quietly put the wording back. The Swahili set is Tanzania's own
 * and is never served on NIETE (observeLang + the market clamp, bd-2405), so it
 * is out of scope here.
 */

const { observeStrings } = require('../../bot/shared/services/observe/observe-strings');
const { parseTeacherDetails } = require('../../bot/shared/services/observe/observe-send.service');

// Every string value in a set, with its key path (nested objects walked).
function walk(obj, prefix = '') {
  const out = [];
  for (const [k, v] of Object.entries(obj || {})) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (typeof v === 'string') out.push([key, v]);
    else if (Array.isArray(v)) v.forEach((x, i) => { if (typeof x === 'string') out.push([`${key}[${i}]`, x]); });
    else if (v && typeof v === 'object') out.push(...walk(v, key));
  }
  return out;
}

const TANZANIA_MARKERS = [
  ['the word Tanzania / Tanzanian', /tanzan/i],
  ['the example name Zainabu', /zainabu/i],
  ['the Tanzania role title "field officer"', /field officer/i],
  ['a Tanzanian 07xx/06xx mobile', /(^|[^\d])0[67]\d{2}[\s-]?\d{3}[\s-]?\d{3}(?!\d)/],
  ['a +255 mobile', /(^|[^\d])\+?255[\s-]?[67]\d{2}/],
  ['Swahili "Tuko pamoja"', /tuko pamoja/i],
  ['Swahili "Mwalimu"', /\bmwalimu\b/i],
  ['Swahili "Habari"', /\bhabari\b/i],
  ['Swahili "Asante"', /\basante\b/i],
];

describe.each(['en', 'ur'])('observeStrings(%s) — no Tanzania leftovers', (lang) => {
  const entries = walk(observeStrings(lang));

  test('the walk reads real entries', () => {
    // A floor, not a count: the tiers carry different feature sets (staging 177
    // strings, sandbox 193 on 7 Nov), and the guard must hold on every one.
    expect(entries.length).toBeGreaterThan(100);
  });

  test.each(TANZANIA_MARKERS)('no value carries %s', (_label, re) => {
    const hits = entries.filter(([, v]) => re.test(v)).map(([k]) => k);
    expect(hits).toEqual([]);
  });
});

describe('the three English strings, as the operator approved them (7 Nov)', () => {
  const en = observeStrings('en');

  test('send_ask_details uses the Urdu example teacher', () => {
    expect(en.send_ask_details).toBe(
      'Tell me the teacher\'s name and phone number — one message.\n\nExample: *Ms. Sania, 0301 2345678*',
    );
  });

  test('send_details_reask asks for "a mobile number" (Option A, no country, like the Urdu)', () => {
    expect(en.send_details_reask).toBe(
      "Sorry, I didn't catch that. Please send the name AND a mobile number together.\n\nExample: *Ms. Sania, 0301 2345678*",
    );
  });

  test('role_denied names the NIETE roles, in the Urdu order, and keeps the line for teachers', () => {
    expect(en.role_denied).toBe(
      '/observe is for school leaders, supervisors, coaches and principals. 💛 If you should have this role, contact your team.\n\n' +
      "If you're a teacher, I'm here for you — type \"menu\" to see what I can do.",
    );
  });
});

describe('the example a coach is shown is one the bot accepts', () => {
  test.each(['en', 'ur'])('the %s send_ask_details example parses to a Pakistani mobile', (lang) => {
    const s = observeStrings(lang).send_ask_details;
    // The example is the bold *…* span after the colon.
    const m = s.match(/\*([^*]+)\*/);
    expect(m).not.toBeNull();
    const parsed = parseTeacherDetails(m[1]);
    expect(parsed).not.toBeNull();
    expect(parsed.phone).toBe('923012345678');
  });

  test('Ms. Sania, 0301 2345678 → { name: "Ms. Sania", phone: "923012345678" }', () => {
    expect(parseTeacherDetails('Ms. Sania, 0301 2345678')).toEqual({ name: 'Ms. Sania', phone: '923012345678' });
  });
});
