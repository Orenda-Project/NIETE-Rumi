/**
 * Task 5 — the pages a topic carries are the book's pages. For one chapter per subject (the lowest grade +
 * chapter that has topics loaded), every topic's pages exist in textbook_pages for that grade's ICT book, and
 * the text of the topic's first page holds a word of the topic's name.
 *
 * A topic's `pages` are the matrix's printed page numbers. If this fails because they are off by a fixed
 * amount, do NOT patch V1.6.18: an offset is a new migration and a controller decision.
 *
 * It needs a database, so it runs only when ASSESSMENT_TOPICS_DB_URL points at the SANDBOX project
 * (olvritwoqujtjvwfulbh) and the real `pg` is installed under dashboard/. Anywhere else — CI included — it
 * skips. It only reads: SELECTs, no writes.
 *
 *   ASSESSMENT_TOPICS_DB_URL="$(grep ^DATABASE_URL= .env.sandbox | cut -d= -f2-)" \
 *     npx jest tests/assessment/topics/pages-match-book.db.test.js --forceExit
 */

const fs = require('fs');
const path = require('path');

const SANDBOX_REF = 'olvritwoqujtjvwfulbh';
const URL = process.env.ASSESSMENT_TOPICS_DB_URL || '';
const PG_PATH = path.join(__dirname, '..', '..', '..', 'dashboard', 'node_modules', 'pg');
const runnable = URL.includes(SANDBOX_REF) && fs.existsSync(PG_PATH);
const maybe = runnable ? describe : describe.skip;

const SUBJECTS = ['english', 'urdu', 'maths', 'science'];

/** The words of a topic name worth looking for: letters only, four or more of them, lower case. */
function nameWords(name) {
  return String(name || '').toLowerCase().split(/[^\p{L}\p{M}]+/u).filter((w) => w.length >= 4);
}

maybe('topic pages match the book (sandbox, read only)', () => {
  let client;

  beforeAll(async () => {
    // eslint-disable-next-line global-require, import/no-dynamic-require
    const { Client } = require(PG_PATH);
    client = new Client({ connectionString: URL, ssl: { rejectUnauthorized: false } });
    await client.connect();
  });

  afterAll(async () => { if (client) await client.end(); });

  test.each(SUBJECTS)('%s: one chapter\'s topics sit on real pages of its book', async (subject) => {
    const first = (await client.query(
      `SELECT grade, chapter_number FROM assessment_topics
        WHERE subject = $1 AND is_current ORDER BY grade, chapter_number LIMIT 1`, [subject])).rows[0];
    if (!first) throw new Error(`no topics loaded for ${subject}`);

    const book = (await client.query(
      `SELECT id FROM textbooks WHERE curriculum = 'ict' AND grade = $1 AND subject = $2 LIMIT 1`,
      [first.grade, subject])).rows[0];
    if (!book) throw new Error(`no ICT book for grade ${first.grade} ${subject}`);

    const topics = (await client.query(
      `SELECT topic_id, name, pages FROM assessment_topics
        WHERE subject = $1 AND grade = $2 AND chapter_number = $3 AND is_current ORDER BY sort_order`,
      [subject, first.grade, first.chapter_number])).rows;

    const problems = [];
    for (const t of topics) {
      const pages = [...(t.pages || [])].sort((a, b) => a - b);
      if (!pages.length) { problems.push(`${t.topic_id}: no pages`); continue; }
      // eslint-disable-next-line no-await-in-loop
      const rows = (await client.query(
        `SELECT textbook_page_number, page_content FROM textbook_pages
          WHERE textbook_id = $1 AND textbook_page_number = ANY($2::int[])`, [book.id, pages])).rows;
      const found = new Map(rows.map((r) => [r.textbook_page_number, r.page_content || '']));
      const missing = pages.filter((p) => !found.has(p));
      if (missing.length) problems.push(`${t.topic_id}: pages not in the book: ${missing.join(', ')}`);

      const text = (found.get(pages[0]) || '').toLowerCase();
      const words = nameWords(t.name);
      if (words.length && !words.some((w) => text.includes(w))) {
        problems.push(`${t.topic_id}: page ${pages[0]} has none of "${t.name}"`);
      }
    }
    expect(topics.length).toBeGreaterThan(0);
    expect(problems).toEqual([]);
  });
});

if (!runnable) {
  test('pages-match-book skips without a sandbox ASSESSMENT_TOPICS_DB_URL and dashboard pg', () => {
    expect(runnable).toBe(false);
  });
}
