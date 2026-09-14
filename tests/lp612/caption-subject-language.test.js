/**
 * bd-63dea — AN URDU CAPTION MUST BE URDU ALL THE WAY ACROSS.
 *
 * OPERATOR, testing on staging (2026-09-13). The Urdu delivery came back reading
 *
 *     استعارہ کی شناخت اور تحریری و زبانی مشقیں
 *     جماعت 7 · Urdu · صفحات 30
 *
 * — an Urdu sentence, an Urdu grade word, an Urdu pages word, and the SUBJECT in English. On a
 * Maths lesson the same line reads «· Mathematics ·». It is the one token on the line that never
 * got translated, which is why it reads as a formatting defect rather than as a missing string.
 *
 * WHY IT HAPPENED. `niete_lp612_segments.subject` is FREE TEXT carried in from the segmentation
 * import — the corpus holds `Mathematics` and `mathematics`, `General Science` and `Science`
 * (see config/lp612-subject-order.js, which exists because of exactly that spread). `buildCaption`
 * interpolated that raw string into `lp612Caption` for both languages, so the Urdu caption
 * inherited whatever English the importer happened to write.
 *
 * THE SHAPE OF THE FIX. `normalizeSubject()` already folds the corpus spellings onto one canonical
 * key; what was missing was a canonical → Urdu name for the 6-12 subject set. The English caption
 * is untouched: the raw string IS the English name, and the menu she taps shows that same string
 * (lp612-catalog.service.js renders `title: clip(subject, …)`), so overriding it here would make
 * the caption disagree with the row she picked.
 *
 * A SUBJECT WITH NO URDU NAME FALLS BACK TO THE RAW STRING, deliberately. The alternative — an
 * empty token, or a transliteration invented at render time — is worse than an English word a
 * teacher already reads on the menu. Asserted below, because a fallback that throws or blanks is
 * the failure mode this kind of map actually has.
 *
 * The service is the REAL module; only the network boundary is mocked (root CLAUDE.md rule 6).
 */

jest.mock('../../bot/shared/services/whatsapp.service', () => ({
  sendMessage: jest.fn(), sendDocumentByLink: jest.fn(),
}));
jest.mock('../../bot/shared/services/lp-shelf.service', () => ({ pushToShelf: jest.fn() }));
jest.mock('../../bot/shared/services/lp612-feedback.service', () => ({ scheduleFeedbackPrompt: jest.fn() }));
jest.mock('../../bot/shared/storage/r2', () => ({
  getPresignedUrl: jest.fn(), buildR2PublicUrl: (k) => `https://r2.example/${k}`,
}));
jest.mock('../../bot/shared/services/lp612-catalog.service', () => ({ segmentById: jest.fn() }));
jest.mock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn() }));
jest.mock('../../bot/shared/utils/structured-logger', () => ({
  logEvent: jest.fn(), getCurrentCorrelationId: () => undefined,
}));
jest.mock('../../bot/shared/config/supabase', () => ({ from: jest.fn(), rpc: jest.fn() }));

const { buildCaption } = require('../../bot/shared/services/lp612-serving.service');

/** the shape `deliverRender` actually hands `buildCaption` — a row off niete_lp612_segments */
const seg = (over = {}) => ({
  segment_id: 's1',
  book_stem: 'b',
  chapter_key: 'c01',
  grade: 7,
  subject: 'Urdu',
  subtopic_title: 'استعارہ کی شناخت اور تحریری و زبانی مشقیں',
  menu_title: 'استعارہ',
  printed_page_start: 30,
  printed_page_end: 30,
  ...over,
});

/** the meta line — everything after the topic. The topic is the book's own wording and is never
 *  translated by us, so asserting on the whole caption would assert on the corpus. */
const metaLine = (caption) => caption.split('\n')[1];

describe('bd-63dea — the Urdu caption carries an Urdu subject name', () => {
  test('THE RED TEST — «Urdu» must not survive into an Urdu caption', () => {
    const line = metaLine(buildCaption(seg({ subject: 'Urdu' }), 'ur'));
    expect(line).toContain('اردو');
    expect(line).not.toMatch(/Urdu/);
  });

  test('Mathematics reads ریاضی, not Mathematics', () => {
    const line = metaLine(buildCaption(seg({ subject: 'Mathematics', grade: 8 }), 'ur'));
    expect(line).toContain('ریاضی');
    expect(line).not.toMatch(/Mathematics/);
  });

  test('English reads انگریزی', () => {
    const line = metaLine(buildCaption(seg({ subject: 'English' }), 'ur'));
    expect(line).toContain('انگریزی');
    expect(line).not.toMatch(/English/);
  });

  // The corpus spelling spread is the whole reason lp612-subject-order.js exists; a map keyed on
  // the literal string would translate one grade's menu and not the next one's, with no visible
  // reason. These are spellings the corpus actually carries.
  test.each([
    ['Science', 'سائنس'],
    ['General Science', 'سائنس'],
    ['math', 'ریاضی'],
    ['mathematics', 'ریاضی'],
    ['Pak Studies', 'مطالعہ پاکستان'],
    ['Islamiat', 'اسلامیات'],
  ])('the corpus spelling %s resolves to %s', (subject, expected) => {
    expect(metaLine(buildCaption(seg({ subject }), 'ur'))).toContain(expected);
  });

  test('a subject with no Urdu name keeps the English string rather than blanking', () => {
    const line = metaLine(buildCaption(seg({ subject: 'Astronomy' }), 'ur'));
    expect(line).toContain('Astronomy');
  });

  // ── the English caption is NOT in scope and must not move ──────────────────
  //
  // The raw string IS the English name, and it is the same string the NavigationList row she
  // tapped was labelled with. A caption that renamed it would read as a different lesson.
  test('the English caption still shows the corpus string verbatim', () => {
    const line = metaLine(buildCaption(seg({ subject: 'Mathematics', grade: 8 }), 'en'));
    expect(line).toBe('Grade 8 · Mathematics · pages 30');
  });

  test('the caption is still two lines, topic first', () => {
    const caption = buildCaption(seg(), 'ur');
    expect(caption.split('\n')).toHaveLength(2);
    expect(caption.split('\n')[0]).toBe('استعارہ کی شناخت اور تحریری و زبانی مشقیں');
  });
});
