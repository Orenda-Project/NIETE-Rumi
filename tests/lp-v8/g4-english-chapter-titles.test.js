/**
 * bd-a3o891 — Grade 4 English chapter titles in the menu were Grade 2's (TDD, red first).
 *
 * Chapters 2-12 of grade_4_english carried grade_2_english's titles ("Food and Friends!",
 * "Heroes of History"...), copied in from the Grade 4 page-truth TOC. The lessons were right;
 * only the WhatsApp LP menu and the lessons list showed the wrong names. The right names are
 * the ones the catalogue's own Grade 4 assessment worksheets already use.
 */

const fs = require('fs');
const path = require('path');
const B = require('../../bot/scripts/build-lp-catalog');

const catalog = JSON.parse(fs.readFileSync(
  path.join(__dirname, '..', '..', 'bot', 'data', 'lp_catalog.json'), 'utf8'));
const book = (key) => catalog.books.find((b) => b.book_key === key);

const G4_TITLES = {
  1: "Pinky's Dental Dilemma",
  2: 'From Farm to Feast',
  3: 'Teamwork Champions',
  4: 'The Great Debate',
  5: 'Journey of a Plastic Bottle',
  6: "Allama Iqbal's (رَحْمَتُ اللہ عَلَيه) visit to Taleemabad",
  7: "Pinky and Jojo's Cool-Down Adventure",
  8: 'Reaching for the Stars',
  9: 'The Dancing Poem',
  10: 'Bridge Builder Unite',
  11: 'Chatter Patterns',
  12: 'Finding Home',
};

describe('Grade 4 English chapter titles (bd-a3o891)', () => {
  const g4 = book('grade_4_english');
  const g2 = book('grade_2_english');

  test.each(Object.entries(G4_TITLES))('chapter %s is "%s"', (num, title) => {
    const ch = g4.chapters.find((c) => String(c.number) === num);
    expect(ch.title).toBe(title);
    expect(ch.title_short).toBe(B.clip(title, B.TITLE_CAP));
  });

  test('no Grade 4 English chapter borrows a Grade 2 English title', () => {
    const g2Titles = new Set(g2.chapters.map((c) => c.title));
    expect(g4.chapters.filter((c) => g2Titles.has(c.title)).map((c) => c.number)).toEqual([]);
  });

  test('each title matches that chapter\'s own assessment worksheet', () => {
    for (const ch of g4.chapters) {
      const ws = ch.lessons.find((l) => /Assessment Worksheet/.test(l.topic || ''));
      expect(ws.topic).toContain(`'${ch.title}'`);
    }
  });
});
