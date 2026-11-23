/**
 * bd-snkn32.59 (queue #165) — "Make my own → A whole unit": a chapter range of her book becomes a day-by-day outline.
 * Amena, 19 Nov: "how would we break it down into days and give teachers voice over how long their period is and
 * what is the recommended pace of that?" Real book days from bot/data/lp_catalog.json (G3 Maths / English / Urdu).
 */
const O = require('../../bot/shared/services/lp-own-unit-outline');
const catalog = require('../../bot/data/lp_catalog.json');

const book = (stem) => catalog.books.find((b) => b.stem === stem);
const MATHS = book('grade_3_math');
const ENGLISH = book('grade_3_english');
const URDU = book('grade_3_urdu');
const kinds = (days) => days.reduce((a, d) => ({ ...a, [d.kind]: (a[d.kind] || 0) + 1 }), {});
const build = (over = {}) => O.buildOutline({ book: MATHS, from: 2, to: 3, pace: 'recommended', period: 35, bookMinutes: 40, ...over });

describe('buildOutline — recommended pace is the book\'s own days, in order', () => {
  it('G3 Maths ch 2-3 at 35 min = 21 days: 17 lesson, 2 review, 2 test', () => {
    const out = build();
    expect(out.ok).toBe(true);
    expect(out.days).toHaveLength(21);
    expect(kinds(out.days)).toEqual({ lesson: 17, review: 2, test: 2 });
  });
  it('each chapter ends with its review day, then its test day', () => {
    const { days } = build();
    expect(days.slice(9, 11).map((d) => d.kind)).toEqual(['review', 'test']);
    expect(days[9].lesson_ids).toEqual(['grade_3_math_ch2_seg990']);
    expect(days[10].lesson_ids).toEqual(['grade_3_math_ch2_seg995']);
    expect(days[11]).toMatchObject({ kind: 'lesson', chapter: 3, lesson_ids: ['grade_3_math_ch3_seg1'] });
    expect(days[20].kind).toBe('test');
  });
  it('a day carries its book topic and chapter', () => {
    expect(build().days[0]).toEqual({
      kind: 'lesson', chapter: 2, lesson_ids: ['grade_3_math_ch2_seg1'], topic: 'Addition without regrouping + on a number line',
    });
  });
  it('English ch 2-3 = 22 days; Urdu ch 2-3 = 12 days (Urdu ch 2 alone = 8, as in the mockup)', () => {
    expect(build({ book: ENGLISH }).days).toHaveLength(22);
    expect(build({ book: URDU }).days).toHaveLength(12);
    expect(build({ book: URDU, to: 2 }).days).toHaveLength(8);
  });
});

describe('buildOutline — slower pace adds one practice day after each topic', () => {
  it('G3 Maths ch 2-3 = 25 (4 topics), each practice day after its topic\'s last lesson day', () => {
    const { days } = build({ pace: 'slower' });
    expect(days).toHaveLength(25);
    expect(kinds(days).practice).toBe(4);
    // ch 2 topic 1 = Days 1-4, so the practice day is the 5th; it practises that topic's days.
    expect(days[4]).toMatchObject({ kind: 'practice', chapter: 2 });
    expect(days[4].lesson_ids).toEqual(['grade_3_math_ch2_seg1', 'grade_3_math_ch2_seg2', 'grade_3_math_ch2_seg3', 'grade_3_math_ch2_seg4']);
  });
  it('a book with no "Topic N" sections counts each chapter as one topic (English 22 → 24)', () => {
    const { days } = build({ book: ENGLISH, pace: 'slower' });
    expect(days).toHaveLength(24);
    const reviewAt = days.findIndex((d) => d.kind === 'review');
    expect(days[reviewAt - 1].kind).toBe('practice');
  });
});

describe('buildOutline — faster pace joins practice days into the day before; review and test stay', () => {
  it('G3 Maths ch 2-3 = 17 days, still 2 reviews and 2 tests', () => {
    const { days } = build({ pace: 'faster' });
    expect(days).toHaveLength(17);
    expect(kinds(days)).toEqual({ lesson: 13, review: 2, test: 2 });
    expect(days[2].lesson_ids).toEqual(['grade_3_math_ch2_seg3', 'grade_3_math_ch2_seg4']);
  });
  it('never joins more than two book days into one', () => {
    expect(build({ pace: 'faster' }).days.every((d) => d.lesson_ids.length <= 2)).toBe(true);
  });
  it('is refused where the book has no practice day to join (English ch 2-3)', () => {
    expect(build({ book: ENGLISH, pace: 'faster' })).toEqual({ ok: false, error: 'no_faster' });
  });
});

describe('buildOutline — a short period splits the heaviest days', () => {
  it('35 min of a 40-min book day is close enough: no split (21)', () => {
    expect(build({ period: 35, bookMinutes: 40 }).days).toHaveLength(21);
  });
  it('30 min of a 40-min day splits 4 of 17 lesson days into two parts (25), never a review or test', () => {
    const { days } = build({ period: 30, bookMinutes: 40 });
    expect(days).toHaveLength(25);
    const parts = days.filter((d) => d.part);
    expect(parts).toHaveLength(8);
    expect(parts.every((d) => d.kind === 'lesson')).toBe(true);
    const first = days.findIndex((d) => d.part === 1);
    expect(days[first + 1]).toMatchObject({ part: 2, lesson_ids: days[first].lesson_ids });
  });
  it('unknown book minutes: no split', () => {
    expect(build({ period: 30, bookMinutes: null }).days).toHaveLength(21);
  });
});

describe('buildOutline — refuses what it cannot plan', () => {
  it.each([
    [{ from: 3, to: 2 }, 'bad_range'],
    [{ from: 2, to: 5 }, 'too_many_chapters'],
    [{ from: 2, to: 99 }, 'bad_range'],
    [{ pace: 'zoom' }, 'bad_pace'],
    [{ period: 12 }, 'bad_period'],
    [{ book: null }, 'no_book'],
  ])('%j → %s', (over, error) => {
    expect(build(over)).toEqual({ ok: false, error });
  });
});

describe('paceCounts — the day count on each pace choice', () => {
  it('G3 Maths ch 2-3 at 35 min: 21 / 25 / 17', () => {
    expect(O.paceCounts({ book: MATHS, from: 2, to: 3, period: 35, bookMinutes: 40 })).toEqual({ recommended: 21, slower: 25, faster: 17 });
  });
  it('faster is null where it is not offered', () => {
    expect(O.paceCounts({ book: ENGLISH, from: 2, to: 3, period: 35, bookMinutes: 40 }).faster).toBeNull();
  });
});
