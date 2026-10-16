'use strict';
/**
 * The first-touch strings (COPY v1.2 §1 M3, M4, M4 fallback, M9, M9 fallback; §0 rules; §4 composition) as the
 * catalog holds them: every key in both slots, the caps in code points, the Urdu quotation marks in logical order
 * (U+201D first), no guillemets, no `*` against a quote, no test words on a family-facing string, Latin runs inside
 * Urdu isolated, and every `.bi` value = the UR value, a blank line, the EN value — the same in both slots.
 *
 * The bilingual BUTTONS (Latin first, « · », then Urdu, so the button paints left to right) are held in door.reply.js,
 * not in the catalog: the catalog's paragraph-direction gate requires an Urdu-slot line that opens with a Latin word
 * to open with U+200F, which would turn the button right to left and push `Record · ریکارڈ کریں` (20/20) past Meta's cap.
 */
jest.mock('../../shared/config/supabase', () => ({}));
jest.mock('../../shared/utils/logger', () => ({ logToFile: jest.fn(), logError: jest.fn() }));
jest.mock('../../shared/utils/structured-logger', () => ({ logEvent: jest.fn() }));

const { UX_STRINGS, resolveUx } = require('../../shared/config/ux-strings');
const Reply = require('../../shared/services/first-touch/door.reply');

const KEYS = [
  'ftDoorBody', 'ftDoorBodyBi', 'ftDoorBtnTeacher', 'ftDoorBtnChild',
  'ftMakerBody', 'ftMakerBodyBi', 'ftMakerBtn',
  'ftMakerFallbackBody', 'ftMakerFallbackBodyKnown', 'ftMakerFallbackBodyUnknown', 'ftMakerFallbackBodyUnknownBi',
  'ftMakerFallbackBtn1', 'ftMakerFallbackBtn2', 'ftMakerFallbackBtn3',
  'ftFamilyBody', 'ftFamilyBodyBi', 'ftFamilyBtn', 'ftFamilyFallback', 'ftFamilyFallbackBi',
];
const BUTTONS = ['ftDoorBtnTeacher', 'ftDoorBtnChild', 'ftMakerBtn', 'ftMakerFallbackBtn1', 'ftMakerFallbackBtn2', 'ftMakerFallbackBtn3', 'ftFamilyBtn'];
const BODIES = KEYS.filter((k) => !BUTTONS.includes(k));
const BI = { ftDoorBodyBi: 'ftDoorBody', ftMakerBodyBi: 'ftMakerBody', ftMakerFallbackBodyUnknownBi: 'ftMakerFallbackBodyUnknown', ftFamilyBodyBi: 'ftFamilyBody', ftFamilyFallbackBi: 'ftFamilyFallback' };
/** The strings that carry an undo line (COPY §4 rule 2): every reply to a phone with no teacher identity. */
const UNDO = ['ftMakerBody', 'ftMakerFallbackBody', 'ftMakerFallbackBodyUnknown', 'ftFamilyBody', 'ftFamilyFallback'];
/** Family- and child-facing (COPY §0 test words): the chooser and the family reply with its fallback. */
const FAMILY = ['ftDoorBody', 'ftDoorBodyBi', 'ftDoorBtnTeacher', 'ftDoorBtnChild', 'ftFamilyBody', 'ftFamilyBodyBi', 'ftFamilyBtn', 'ftFamilyFallback', 'ftFamilyFallbackBi'];
const cp = (s) => [...s].length;
const slots = (k) => [UX_STRINGS[k].en, UX_STRINGS[k].ur];

test('every first-touch key is in the catalog with both slots, and resolves', () => {
  for (const k of KEYS) {
    expect(typeof UX_STRINGS[k].en).toBe('string');
    expect(typeof UX_STRINGS[k].ur).toBe('string');
    expect(UX_STRINGS[k].en.trim()).not.toBe('');
    expect(UX_STRINGS[k].ur.trim()).not.toBe('');
    expect(resolveUx(k, { language: 'ur' })).toBe(UX_STRINGS[k].ur);
  }
});

test('caps in code points: reply/cta buttons ≤ 20 (the bilingual ones too), bodies ≤ 1024', () => {
  for (const k of BUTTONS) for (const s of slots(k)) expect(cp(s)).toBeLessThanOrEqual(20);
  for (const s of Object.values(Reply.BI_BUTTONS)) expect(cp(s)).toBeLessThanOrEqual(20);
  for (const k of BODIES) for (const s of slots(k)) expect(cp(s)).toBeLessThanOrEqual(1024);
  expect(cp(Reply.BI_BUTTONS.fallback3)).toBe(20);   // `Record · ریکارڈ کریں`: exactly at the cap, as COPY signed it
});

test('a .bi body is ONE value, the same in both slots: the UR value, a blank line, the EN value (COPY §4 rule 1)', () => {
  for (const [bi, base] of Object.entries(BI)) {
    expect(UX_STRINGS[bi].en).toBe(UX_STRINGS[bi].ur);
    const ur = base === 'ftDoorBody' ? UX_STRINGS.ftDoorBody.ur : UX_STRINGS[base].ur;
    expect(UX_STRINGS[bi].ur).toBe(`${ur}\n\n${UX_STRINGS[base].en}`);
  }
});

test('bilingual buttons: the EN word(s), « · », the UR word(s), Latin first so the button paints left to right', () => {
  for (const s of Object.values(Reply.BI_BUTTONS)) {
    expect(s).toMatch(/^[A-Za-z][A-Za-z ]* · [؀-ۿ][؀-ۿ ]*$/u);
  }
});

test('the undo lines: UR quotes ”…“ (U+201D first), EN quotes “…”, no guillemets, no * against a quote', () => {
  for (const k of UNDO) {
    expect(UX_STRINGS[k].ur).toMatch(/”[؀-ۿ]+“/u);
    expect(UX_STRINGS[k].en).toMatch(/“[a-z]+”/);
    for (const s of slots(k)) expect(s).not.toMatch(/\*[“”]|[“”]\*/);
  }
  for (const k of KEYS) for (const s of slots(k)) expect(s).not.toMatch(/[«»]/);
  for (const s of Object.values(Reply.BI_BUTTONS)) expect(s).not.toMatch(/[«»]/);
  // the undo line comes BEFORE the colon prompt, and a colon line is always last (COPY §4 rule 3)
  expect(UX_STRINGS.ftMakerFallbackBody.ur.split('\n').pop()).toBe('ایک چنیں:');
  expect(UX_STRINGS.ftMakerFallbackBodyUnknown.en.split('\n').pop()).toBe('Pick one to start:');
});

test('no test word on a family- or child-facing string', () => {
  for (const k of FAMILY) for (const s of slots(k)) expect(s).not.toMatch(/\b(?:test|exam|assessment)\b|امتحان|ٹیسٹ/i);
  for (const s of [Reply.BI_BUTTONS.doorTeacher, Reply.BI_BUTTONS.doorChild, Reply.BI_BUTTONS.family]) expect(s).not.toMatch(/test|exam|امتحان|ٹیسٹ/i);
});

test('every Latin run of 2+ letters inside an Urdu (non-.bi) value is inside a U+2066…U+2069 isolate', () => {
  for (const k of KEYS.filter((x) => !BI[x])) {
    const outside = UX_STRINGS[k].ur.replace(/⁦[^⁩]*⁩/g, '');
    expect(outside).not.toMatch(/[A-Za-z]{2,}/);
  }
});

test('text-only replies say nothing about tapping (COPY §4 rule 4)', () => {
  expect(UX_STRINGS.ftFamilyFallback.en).not.toMatch(/\btap\b/i);
  expect(UX_STRINGS.ftFamilyFallback.ur).not.toMatch(/ٹیپ/);
});
