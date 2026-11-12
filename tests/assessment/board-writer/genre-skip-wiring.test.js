'use strict';
// bd-qyi45h.1: writeBoardPaper on the G11 Urdu board pattern. When the chosen pages carry no ghazal (or no poem) the
// model writes nothing for those slots; the paper used to fail PATTERN_SHORT_SLOT. Now those slots are left out and the
// printed total follows the paper. Recorded (fictional) replies, no network.
jest.mock('../../../bot/shared/services/assessment/fde-layout', () => ({
  applyLayout: () => { throw new Error('applyLayout must never be called by the board writer'); },
}));
const A = '../../../bot/shared/services/assessment/';
const { writeBoardPaper } = require(`${A}board-writer`);
const hssc1 = require(`${A}patterns/board/fbise-hssc1`);
const ssc1 = require(`${A}patterns/board/fbise-ssc1`);
const { makeDeps, buildReply } = require('./helpers/fake-deps');

const TOS = { levels: { K: 30, U: 50, A: 20 }, tolerance_pp: 5 };
const FILL = 'مصنف نے اس بات کی مزید وضاحت کی ہے۔';
const span = (first, body) => [0, 1, 2].map((i) => `=== Page ${first + i} ===\n${i ? FILL : body}`).join('\n');
const PROSE = span(12, 'اس سبق میں مصنف نے گاؤں کی زندگی بیان کی ہے۔ طلبہ نظم و نثر کا فرق جانیں گے۔');
const NAZM = span(81, 'اس نظم میں شاعر نے صبح کا منظر پیش کیا ہے۔ نظم/غزل کے اشعار کی تشریح کیجیے۔');
const GHAZAL = span(111, '# غزل\nمیر تقی میر کی غزل پڑھیے۔ اس غزل کا مطلع دوبارہ لکھیے۔');
const GENRE = { poem: /poem|^3\.Q4$/, ghazal: /ghazal|^3\.Q5$/ };

function cellOf(grade, subject, P, medium) {
  const variant = P.variants[0];
  const row = { code: subject, grade, band: '11_12', medium, rtl: medium === 'ur', prompt_key: `eg.ict.${subject}.11_12.system`, tos_default: TOS, board_mode: 'board' };
  return { grade, subject, P, variant, row, style: variant.scheme_style, ur: medium === 'ur' };
}
const URDU = cellOf(11, 'urdu', hssc1.subjects.urdu, 'ur');

/** The model, given `content`, writes nothing for the genres in `missing` (it has no poem/ghazal to quote). */
async function run(cell, content, missing = []) {
  const levels = cell.variant.cognitive_split.levels;
  const ctx = { grade: cell.grade, row: cell.row, levels, style: cell.style, ur: cell.ur };
  const skip = (s) => missing.some((g) => GENRE[g].test(s.slot));
  const { d } = makeDeps({ ...cell, levels, reply: (section, n, topUp, state) => buildReply(section.slots.filter((s) => !skip(s)), ctx, state) });
  d.loadPatternContent = async () => ({ content, pageReference: 'pp 1-9' });
  return writeBoardPaper({ grade: cell.grade, subject: cell.subject, pattern: 'fbise_hssc1_2027', P: cell.P, variant: cell.variant, requestId: 'r1' }, d);
}
const slotIds = (L) => L.slots.map((s) => s.slot);

describe('G11 Urdu board paper: poem / ghazal slots follow the chosen pages', () => {
  test('no ghazal: ghazal slots left out, no PATTERN_SHORT_SLOT, header total = the paper (87)', async () => {
    const res = await run(URDU, [PROSE, NAZM].join('\n'), ['ghazal']);
    const L = res.examJson._layout;
    expect(slotIds(L)).not.toContain('2.Q2c ghazal');
    expect(slotIds(L)).not.toContain('3.Q5');
    expect(slotIds(L)).toEqual(expect.arrayContaining(['2.Q2b poem', '3.Q4']));
    expect(L.total_marks).toBe(87);
    expect(L.header.lines_en.join(' ')).toContain('Total Marks: {t:87}');
    expect(L.checks.hard).toBe(0);
  });
  test('no poem: poem slots left out, ghazal slots kept', async () => {
    const res = await run(URDU, [PROSE, GHAZAL].join('\n'), ['poem']);
    const L = res.examJson._layout;
    expect(slotIds(L)).not.toContain('2.Q2b poem');
    expect(slotIds(L)).not.toContain('3.Q4');
    expect(slotIds(L)).toEqual(expect.arrayContaining(['2.Q2c ghazal', '3.Q5']));
    expect(L.total_marks).toBe(81);
    expect(L.checks.hard).toBe(0);
  });
  test('prose only: printed numbers run on (Q3, Q4, Q5) and the scheme legend says why', async () => {
    const L = (await run(URDU, PROSE, ['poem', 'ghazal'])).examJson._layout;
    const label = (id) => L.slots.find((s) => s.slot === id);
    expect(['3.Q3', '3.Q6', '3.Q7'].map((id) => label(id).label)).toEqual(['Q3', 'Q4', 'Q5']);
    expect(['3.Q3', '3.Q6', '3.Q7'].map((id) => label(id).label_ur)).toEqual(['سوال 3', 'سوال 4', 'سوال 5']);
    expect(label('2.Q2d grammar').label).toBe('Q2b grammar');
    expect(L.legend.lines_en.join(' ')).toContain('No poem in the chosen pages, so the poem questions are left out.');
    expect(L.legend.lines_ur.join(' ')).toContain('منتخب صفحات میں کوئی غزل نہیں، اس لیے غزل کے سوالات شامل نہیں کیے گئے۔');
    expect(L.checks.hard).toBe(0);
  });
  test('prose only, printed: the Urdu paper numbers run on and the Urdu scheme carries both notes', async () => {
    const exam = (await run(URDU, PROSE, ['poem', 'ghazal'])).examJson;
    const paper = require(`${A}assessment-paper-board.renderer`).renderBoardPaper(exam);
    const scheme = require(`${A}assessment-scheme-board.renderer`).renderBoardScheme(exam);
    // the printed question headings (slot head, or the bold label of a teacher-marked slot), Urdu digits as printed
    const heads = [...paper.matchAll(/(?:<div class="slot-head"><span>|<div class="teacher-slot"><b>)(.*?)<\/(?:span><span class="ml"|b>)/g)]
      .map((m) => m[1].replace(/<span class="num">(.*?)<\/span>/g, '$1'));
    expect(heads.filter((h) => h.startsWith('سوال'))).toEqual(['سوال ۱', 'سوال ۳', 'سوال ۴', 'سوال ۵']);
    expect(heads).toEqual(expect.arrayContaining(['Q۲a prose', 'Q۲b grammar']));
    expect(scheme).toContain('منتخب صفحات میں کوئی نظم نہیں، اس لیے نظم کے سوالات شامل نہیں کیے گئے۔');
    expect(scheme).toContain('منتخب صفحات میں کوئی غزل نہیں، اس لیے غزل کے سوالات شامل نہیں کیے گئے۔');
    expect(paper).not.toContain('منتخب صفحات');
  });
  test('both present: no note, the pattern\'s own numbers', async () => {
    const L = (await run(URDU, [PROSE, NAZM, GHAZAL].join('\n'))).examJson._layout;
    expect(L.legend.lines_en.join(' ')).not.toContain('chosen pages');
    expect(L.slots.find((s) => s.slot === '3.Q7').label).toBe('Q7');
  });
  test('both present: the full paper, total 100, every slot', async () => {
    const res = await run(URDU, [PROSE, NAZM, GHAZAL].join('\n'));
    const L = res.examJson._layout;
    expect(slotIds(L)).toEqual(URDU.variant.sections.flatMap((s) => s.slots.map((x) => x.slot)));
    expect(L.total_marks).toBe(100);
    expect(L.header.lines_en.join(' ')).toContain('Total Marks: {t:100}');
  });
  test('a 2-page choice from inside a ghazal chapter, no marker on it: ghazal slots kept, full 100', async () => {
    const two = '=== Page 140 ===\nشاعر کا تعارف۔\n=== Page 141 ===\nمشکل الفاظ کے معنی لکھیے۔';
    const L = (await run(URDU, two)).examJson._layout;
    expect(slotIds(L)).toEqual(expect.arrayContaining(['2.Q2c ghazal', '3.Q5', '2.Q2b poem', '3.Q4']));
    expect(L.total_marks).toBe(100);
  });
  test('not Urdu: English keeps its poem slot on prose-only pages', async () => {
    const eng = { ...cellOf(9, 'english', ssc1.subjects.english, 'en') };
    const res = await run(eng, PROSE);
    expect(slotIds(res.examJson._layout)).toContain('B.Q3');
    expect(res.examJson._layout.total_marks).toBe(eng.variant.total_marks);
  });
});
