'use strict';
// bd-qyi45h.1: the G11/G12 Urdu board papers drop their poem slots when the chosen pages carry no poem, and their
// ghazal slots when they carry no ghazal, so a prose-only choice no longer fails PATTERN_SHORT_SLOT.
// Book text below is made up; the markers are the ones the G11/G12 Urdu books print.
const A = '../../../bot/shared/services/assessment/';
const GP = require(`${A}board-6-12/genre-presence`);
const hssc1 = require(`${A}patterns/board/fbise-hssc1`);
const hssc2 = require(`${A}patterns/board/fbise-hssc2`);
const ssc1 = require(`${A}patterns/board/fbise-ssc1`);

// A genre is only declared absent on a 3+ page choice, so each fixture spans three book pages.
const FILL = 'مصنف نے اس بات کی مزید وضاحت کی ہے۔';
const span = (first, body) => [0, 1, 2].map((i) => `=== Page ${first + i} ===\n${i ? FILL : body}`).join('\n');
const PROSE = span(12, 'اس سبق میں مصنف نے گاؤں کی زندگی بیان کی ہے۔ طلبہ نظم و نثر کا فرق جانیں گے۔ حاصلاتِ تعلم: مصنف/شاعر کا تعارف۔');
const NAZM = span(81, 'اس نظم میں شاعر نے صبح کا منظر پیش کیا ہے۔ نظم/غزل کے اشعار کی تشریح کیجیے۔');
const NAZM_UNLABELLED = span(106, 'درج ذیل اشعار کی تشریح کیجیے اور شاعر کا پیغام لکھیے۔');
const GHAZAL = span(111, '# غزل\nمیر تقی میر کی غزل پڑھیے۔ اس غزل کا مطلع دوبارہ لکھیے۔');
const urdu1 = hssc1.subjects.urdu.variants[0];
const urdu2 = hssc2.subjects.urdu.variants[0];
const slotsOf = (V) => V.sections.flatMap((s) => s.slots.map((x) => x.slot));
const x4 = (m) => Math.round(m * 4);

describe('presence: which genres the chosen pages carry', () => {
  test('prose pages: neither (bare نظم / غزل in SLO boilerplate do not count)', () => {
    expect(GP.presence(PROSE)).toEqual({ poem: false, ghazal: false });
  });
  test('a nazm page: poem, no ghazal, even with the "نظم/غزل کے اشعار" boilerplate', () => {
    expect(GP.presence(NAZM)).toEqual({ poem: true, ghazal: false });
  });
  test('a nazm page that only says اشعار still counts as poem', () => {
    expect(GP.presence(NAZM_UNLABELLED)).toEqual({ poem: true, ghazal: false });
  });
  test('a ghazal page: ghazal; its اشعار alone do not make a poem', () => {
    expect(GP.presence(GHAZAL)).toEqual({ poem: false, ghazal: true });
  });
  test('prose + nazm + ghazal: both', () => {
    expect(GP.presence([PROSE, NAZM, GHAZAL].join('\n'))).toEqual({ poem: true, ghazal: true });
  });
  test('a 1-2 page choice never declares a genre absent (too little text to tell)', () => {
    const two = '=== Page 140 ===\nشاعر کا تعارف۔\n=== Page 141 ===\nمشکل الفاظ کے معنی لکھیے۔';
    expect(GP.presence(two)).toEqual({ poem: true, ghazal: true });
    expect(GP.presence('=== Page 12 ===\nاس سبق میں مصنف نے گاؤں کی زندگی بیان کی ہے۔')).toEqual({ poem: true, ghazal: true });
    expect(GP.presence('اس سبق میں مصنف نے گاؤں کی زندگی بیان کی ہے۔')).toEqual({ poem: true, ghazal: true });
  });
  test('the page count is distinct pages: a repeated marker does not make a short choice long', () => {
    const rep = '=== Page 12 ===\nنثر\n=== Page 12 ===\nنثر\n=== Page 13 ===\nنثر';
    expect(GP.presence(rep)).toEqual({ poem: true, ghazal: true });
  });
  test('no content at all: both kept (never claim absent without the text)', () => {
    expect(GP.presence('')).toEqual({ poem: true, ghazal: true });
    expect(GP.presence(null)).toEqual({ poem: true, ghazal: true });
  });
});

describe('forContent: the variant the writer uses', () => {
  test('no ghazal: the two ghazal slots go, the total follows the paper (HSSC-I 100 -> 87)', () => {
    const V = GP.forContent(urdu1, 'urdu', [PROSE, NAZM].join('\n'));
    expect(slotsOf(V)).not.toEqual(expect.arrayContaining(['2.Q2c ghazal']));
    expect(slotsOf(V)).not.toContain('3.Q5');
    expect(slotsOf(V)).toContain('2.Q2b poem');
    expect(slotsOf(V)).toContain('3.Q4');
    expect(V.total_marks).toBe(87);
    expect(V.generated_marks).toBe(87);
    const s2 = V.sections.find((s) => s.id === '2');
    const s3 = V.sections.find((s) => s.id === '3');
    expect([s2.marks, s2.marks_x4, s2.marks_en, s2.marks_ur]).toEqual([44, 176, 'Total Marks: {t:44}', 'کل نمبر: {t:44}']);
    expect([s3.marks, s3.marks_x4]).toEqual([23, 92]);
    expect(V.exam_header.lines_en.join(' ')).toContain('Total Marks: {t:87}');
    expect(V.exam_header.lines_ur.join(' ')).toContain('کل نمبر: {t:87}');
    expect(V.exam_header.lines_en.join(' ')).not.toContain('{t:100}');
    expect(V.sections.reduce((n, s) => n + s.marks_x4, 0)).toBe(x4(V.total_marks));
  });
  test('no poem: the two poem slots go (HSSC-II 100 -> 85), ghazal slots stay', () => {
    const V = GP.forContent(urdu2, 'urdu', [PROSE, GHAZAL].join('\n'));
    expect(slotsOf(V)).not.toContain('2.Q2b poem');
    expect(slotsOf(V)).not.toContain('3.Q4');
    expect(slotsOf(V)).toEqual(expect.arrayContaining(['2.Q2c ghazal', '3.Q5']));
    expect(V.total_marks).toBe(85);
    expect(V.exam_header.lines_en.join(' ')).toContain('Total Marks: {t:85}');
  });
  test('prose only: both go; prose, grammar and the other slots are untouched (only printed labels renumber)', () => {
    const V = GP.forContent(urdu1, 'urdu', PROSE);
    const kept = slotsOf(urdu1).filter((id) => !['2.Q2b poem', '2.Q2c ghazal', '3.Q4', '3.Q5'].includes(id));
    expect(slotsOf(V)).toEqual(kept);
    V.sections.forEach((s) => s.slots.forEach((x) => {
      const was = urdu1.sections.find((o) => o.id === s.id).slots.find((o) => o.slot === x.slot);
      expect({ ...x, label_en: was.label_en, label_ur: was.label_ur }).toEqual(was);
    }));
    expect(V.total_marks).toBe(100 - 12 - 4 - 7 - 9);
  });
  test('both present: the very same variant comes back', () => {
    expect(GP.forContent(urdu1, 'urdu', [PROSE, NAZM, GHAZAL].join('\n'))).toBe(urdu1);
    expect(GP.forContent(urdu2, 'urdu', [NAZM, GHAZAL].join('\n'))).toBe(urdu2);
  });
  test('a 2-page ghazal-chapter choice with no marker keeps every slot (today\'s paper)', () => {
    const two = '=== Page 140 ===\nشاعر کا تعارف۔\n=== Page 141 ===\nمشکل الفاظ کے معنی لکھیے۔';
    expect(GP.forContent(urdu1, 'urdu', two)).toBe(urdu1);
  });
  test('not Urdu: unchanged even on prose-only pages (English keeps its poem slot)', () => {
    const eng = ssc1.subjects.english.variants[0];
    expect(GP.forContent(eng, 'english', PROSE)).toBe(eng);
  });
  test('no variant passes through', () => {
    expect(GP.forContent(null, 'urdu', PROSE)).toBe(null);
  });
  test('the pattern itself is never changed', () => {
    const before = JSON.stringify(urdu1);
    GP.forContent(urdu1, 'urdu', PROSE);
    expect(JSON.stringify(urdu1)).toBe(before);
  });
});
