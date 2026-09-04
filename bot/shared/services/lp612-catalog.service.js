/**
 * The 6-12 menu tree: grade -> subject -> chapter -> subtopic.
 *
 * The teacher walks the BOOK's own segmentation, in taught order. Nothing here
 * invents a better sequence than the book's; `order_index` is the book's and the
 * rows come out in it.
 *
 * This is the K-5 v8 catalogue's shape (NavigationList rows, `payload.step`
 * dispatch, 20 rows a screen with a More row) driven off the database instead of
 * a static JSON file, because 6-12 segments arrive book by book as the fleet
 * finishes them and a new book must appear without a deploy or a Flow republish.
 *
 * Two rules that cost the K-5 lane real bugs and are re-encoded here:
 *
 *  - **Meta does not ride screen data along with a tap** (learned the hard way on
 *    the K-5 lane). Every field the next step needs is in the row's own payload,
 *    or that screen cannot be built.
 *  - **The caps are CODE POINTS** (root CLAUDE.md Rule 20). Title 30,
 *    description 20, metadata 80, 20 rows a screen. `V8Catalog.clip` is the one
 *    measure; this module borrows it rather than growing a second.
 *
 * The religious hold is applied HERE, in the query, not at the last step: a
 * subject the operator has held is absent from the menu, not present and
 * refusing. See bot/shared/config/lp612-flags.js.
 */

const supabase = require('../config/supabase');
const { logToFile } = require('../utils/logger');
const { clip, cps, TITLE_CAP, DESC_CAP, META_CAP, PAGE_SIZE, MORE_ROW_ID } =
  require('./lp-v8-catalog.service');
const { isReligiousEnabled, LP612_MIN_GRADE, LP612_MAX_GRADE } = require('../config/lp612-flags');

const TABLE = 'niete_lp612_segments';

/** Urdu (Extended Arabic-Indic) digits for RTL row furniture — mirrors the K-5
 *  builder so the two lanes read identically on an Urdu handset. */
const urD = (s) => String(s).replace(/[0-9]/g, (d) => '۰۱۲۳۴۵۶۷۸۹'[Number(d)]);
const RLM = '‏';

const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

/**
 * Every menu read goes through here, so the two filters that must never be
 * forgotten cannot be: current rows only, and — while the hold stands — nothing
 * religious. The hold is checked per call rather than cached, so flipping
 * LP_612_RELIGIOUS_ENABLED takes effect on the next tap with no restart.
 */
function menuQuery(columns) {
  let q = supabase.from(TABLE).select(columns).eq('is_current', true);
  if (!isReligiousEnabled()) q = q.eq('is_religious', false);
  return q;
}

/**
 * Narrow a menu read to one grade — INCLUDING the rows that merely list it.
 *
 * `grade_9_10_chemistry_experiment` is one practicals book taught in both years. It is stored as
 * a single row (grade 9, also_grades {10}) so that segment_id, the render and the R2 cache entry
 * stay singular; the price is that every read has to ask both questions, or the book is invisible
 * in grade 10 and the import looks successful while the teacher sees nothing.
 */
function byGrade(q, grade) {
  const g = Number(grade);
  return q.or(`grade.eq.${g},also_grades.cs.{${g}}`);
}

async function run(q, what) {
  const { data, error } = await q;
  if (error) {
    logToFile('LP 6-12 catalog: supabase error', { what, error: error.message });
    return [];
  }
  return data || [];
}

// ── grade ───────────────────────────────────────────────────────────────────

/**
 * Only grades that actually have segments. Unlike the K-5 lane's static 1..10
 * dropdown, an empty grade here would dead-end: there is no "no LPs yet"
 * fallback corpus behind it, so it is simply not offered.
 */
async function buildGradeItems() {
  // ONE BOUNDED PROBE PER GRADE — never a scan.
  //
  // This used to derive the DISTINCT list in JS from `select('grade')` across
  // every servable row. PostgREST answers an unbounded select with at most its
  // max-rows (1,000 by default), so once the corpus passed a thousand segments
  // the tail of the table stopped existing as far as the picker was concerned.
  //
  // On staging with the real corpus (4,565 servable rows) that showed up as a
  // grade picker offering 6, 7, 8, 10, 11: grade 9 and grade 12 had fallen off
  // the end of the first page. No error, no empty screen — two whole grades
  // silently absent from a menu that looked fine. The lane was built against
  // three books, and 198 rows fit in one page.
  //
  // Seven indexed `limit(1)` existence checks answer the same question in
  // bounded work, and cannot degrade as the corpus grows.
  const candidates = [];
  for (let g = LP612_MIN_GRADE; g <= LP612_MAX_GRADE; g++) candidates.push(g);

  const present = await Promise.all(candidates.map(async (g) => {
    const rows = await run(byGrade(menuQuery('grade'), g).limit(1), `grade ${g}`);
    return rows.length ? g : null;
  }));

  const grades = present.filter((g) => g !== null).sort((a, b) => a - b);

  return grades.map((g) => ({
    id: String(g),
    'main-content': {
      title: clip(`Grade ${g}`, TITLE_CAP),
      description: 'Tap to open',
    },
    // `step: 'grade'` on purpose — this row is rendered on the SAME grade screen
    // as the K-5 rows, and the endpoint's existing grade handler decides which
    // lane a grade belongs to. One grade picker, two corpora behind it.
    'on-click-action': { name: 'data_exchange', payload: { step: 'grade', grade: String(g) } },
  }));
}

// ── subject ─────────────────────────────────────────────────────────────────

async function buildSubjectItems(grade) {
  const rows = await run(
    byGrade(menuQuery('subject, chapter_key, language'), grade),
    'subjects',
  );

  const bySubject = new Map();
  for (const r of rows) {
    if (!r.subject) continue;
    const e = bySubject.get(r.subject) || { chapters: new Set(), lessons: 0, rtl: false };
    e.chapters.add(r.chapter_key);
    e.lessons += 1;
    if (r.language === 'ur') e.rtl = true;
    bySubject.set(r.subject, e);
  }

  return [...bySubject.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .slice(0, PAGE_SIZE)
    .map(([subject, e]) => {
      const n = (v) => (e.rtl ? urD(v) : String(v));
      return {
        id: subject,
        'main-content': {
          title: clip(subject, TITLE_CAP),
          description: clip(`${n(e.chapters.size)} chapters`, DESC_CAP),
          metadata: clip(`Grade ${n(grade)} · ${n(e.lessons)} lessons`, META_CAP),
        },
        'on-click-action': {
          name: 'data_exchange',
          payload: { step: 'lp612_subject', grade: String(grade), subject },
        },
      };
    });
}

// ── chapter ─────────────────────────────────────────────────────────────────

/**
 * Paginated like the segment list, and for the same reason a More row exists
 * there: this list used to `.slice(0, PAGE_SIZE)` with NO overflow row, so 53
 * chapters across 13 staging books (Islamiat, Chemistry, Urdu) simply did not
 * exist for a teacher — chapter 21 of a 27-chapter book was unreachable with
 * no error and nothing to tap. Page 1 carries PAGE_SIZE-1 real rows
 * plus the More row; overflow lands on SELECT_CHAPTER_MORE because Meta
 * rejects a row that routes back to its own screen.
 *
 * @returns {Promise<{items: object[], hasMore: boolean, total: number, page: number}>}
 */
async function buildChapterItems(grade, subject, page = 1) {
  const rows = await run(
    byGrade(menuQuery('chapter_key, chapter_number, chapter_title, part, language, order_index'), grade)
      .eq('subject', subject),
    'chapters',
  );

  const byChapter = new Map();
  for (const r of rows) {
    if (!r.chapter_key) continue;
    const e = byChapter.get(r.chapter_key) || {
      number: r.chapter_number,
      title: r.chapter_title,
      part: r.part,
      rtl: r.language === 'ur',
      lessons: 0,
    };
    e.lessons += 1;
    byChapter.set(r.chapter_key, e);
  }

  // The WHOLE book, in order — pagination slices AFTER the naming pass below,
  // so a chapter number that repeats on a later page still counts as repeated
  // and keeps its own words.
  const ordered = [...byChapter.entries()]
    .sort((a, b) => (a[1].number ?? 999) - (b[1].number ?? 999) || a[0].localeCompare(b[0]));

  // ── pass 1: one shape for every row ──────────────────────────────────────
  //
  // ONE FORMAT, EVERY CHAPTER, EVERY BOOK. The chapter NUMBER is the title, the
  // lesson count is the description, and the chapter NAME is always on the
  // metadata line — never sometimes here and sometimes there.
  //
  // This replaces the K-5 reseat rule that was ported in bd-3uiev (name merges
  // into the title when it fits, moves to metadata when it does not). That rule
  // loses nothing, and it still shipped a menu the operator called broken:
  //
  //   "it is inconsistent. Some chapters have their menu in the smaller
  //    subtitle field, some in the upper field. All of them need to have it in
  //    the consistent format so it fits chapter name and looks coherent too."
  //
  // He is right, and the reason is worth keeping: length is a property of the
  // DATA, so a length-conditional layout makes the design of the row depend on
  // which book a teacher opened. Grade 9 Physics then reads as two lists
  // stapled together — `Ch 2 — KINEMATICS` in bold beside a bare `Ch 1` whose
  // name is in small grey text. Nothing is missing; it just looks broken.
  //
  // Which field the name goes in is decided by the caps, not by taste: title is
  // 30 code points and description is 20, and 277 of 761 chapter names in this
  // corpus exceed 30. Metadata's 80 is the only field that holds a real chapter
  // name, so metadata is where the name lives — for the 4-character ones too.
  //
  // A consequence, accepted deliberately: books that repeat a chapter number
  // (grade 11 Urdu's p1c01/p2c01/p3c01, grade 6 English's c01a/c01b) now show
  // the same title twice or three times. That is fine BECAUSE the name is
  // always rendered — every row is told apart on the same line, rather than by
  // whichever field that particular row happened to use. Uniqueness moved to a
  // consistent place; it did not disappear.
  const prepared = ordered.map(([chapterKey, e]) => {
    const n = (v) => (e.rtl ? urD(v) : String(v));
    const lead = e.rtl ? RLM : '';
    const name = e.title || chapterKey;
    const num = e.number != null ? (e.rtl ? `باب ${n(e.number)}` : `Ch ${e.number}`) : '';
    // The part rides with the number so a part-split book still labels its
    // sections. Both sides of this dot are words, so it is clear of the
    // Nastaliq digit-adjacency hazard handled in buildSegmentItems (bd-t8mbl).
    const token = [e.part, num].filter(Boolean).join(' · ');
    return { chapterKey, e, n, lead, name, token };
  });

  // ── pagination window (AFTER the naming pass — see above) ────────────────
  const total = prepared.length;
  const p = Math.max(1, parseInt(String(page), 10) || 1);
  const perPage = PAGE_SIZE - 1;
  const start = (p - 1) * perPage;
  const pageSlice = prepared.slice(start, start + perPage);
  const hasMore = start + perPage < total;

  // ── pass 2: the rows ─────────────────────────────────────────────────────
  const items = pageSlice.map(({ chapterKey, e, n, lead, name, token }) => {
    // Every row, identically: number / count / name. A book with no chapter
    // number at all has nothing to put in the title, so it falls back to the
    // name there — the name still also appears on its own line, so the row
    // keeps the same shape as its siblings rather than gaining a field they
    // lack. (No book in the corpus is numberless today; this is the guard.)
    const mc = {
      title: clip(`${lead}${token || name}`, TITLE_CAP),
      // Urdu rows get Urdu furniture, matching the K-5 builder's `اسباق`. A
      // localised digit beside an English noun is worse than either alone: in a
      // right-to-left row the English word lands FIRST, so `۶ lessons` reads as
      // "lessons ۶" on the handset (bd-t8mbl).
      description: clip(e.rtl ? `${lead}${n(e.lessons)} اسباق` : `${e.lessons} lessons`, DESC_CAP),
      // ALWAYS. Not "when it did not fit above" — that conditional is the whole
      // bug this row shape exists to remove (bd-tnvpg).
      metadata: clip(`${lead}${name}`, META_CAP),
    };

    return {
      id: chapterKey,
      'main-content': mc,
      'on-click-action': {
        name: 'data_exchange',
        payload: {
          step: 'lp612_chapter',
          grade: String(grade),
          subject,
          chapter_key: chapterKey,
        },
      },
    };
  });

  if (hasMore) {
    // The overflow row speaks the book's language, like the segment lane's
    // overflow row: «مزید ابواب ←» with the arrow pointing the reading direction.
    const moreRtl = !!(pageSlice[0] && pageSlice[0].e.rtl);
    items.push({
      id: MORE_ROW_ID,
      'main-content': moreRtl
        ? { title: clip(`${RLM}مزید ابواب ←`, TITLE_CAP), description: `${RLM}اگلا صفحہ` }
        : { title: clip('More chapters →', TITLE_CAP), description: 'Next page' },
      'on-click-action': {
        name: 'data_exchange',
        payload: {
          step: 'lp612_chapter_page',
          grade: String(grade),
          subject,
          page: String(p + 1),
        },
      },
    });
  }

  return { items, hasMore, total, page: p };
}

// ── subtopic (the row that authors a lesson) ────────────────────────────────

/**
 * The book's subtopics for one chapter, in taught order, paginated.
 *
 * Page 1 carries PAGE_SIZE-1 real rows plus a More row, because Meta rejects a
 * row that routes back to its own screen — overflow has to be a second screen.
 */
async function buildSegmentItems(grade, subject, chapterKey, page = 1) {
  const rows = await run(
    byGrade(menuQuery('segment_id, menu_title, subtopic_title, printed_page_start, printed_page_end, ' +
              'order_index, lp_type, language, yt'), grade)
      .eq('subject', subject)
      .eq('chapter_key', chapterKey)
      .order('order_index', { ascending: true }),
    'segments',
  );

  const total = rows.length;
  const p = Math.max(1, parseInt(String(page), 10) || 1);
  const perPage = PAGE_SIZE - 1;
  const start = (p - 1) * perPage;
  const slice = rows.slice(start, start + perPage);
  const hasMore = start + perPage < total;

  const items = slice.map((r) => {
    const rtl = r.language === 'ur';
    const n = (v) => (rtl ? urD(v) : String(v));
    const lead = rtl ? RLM : '';
    // `ص` and Urdu digits on an Urdu book, matching the K-5 builder (bd-t8mbl).
    const pageMark = rtl ? 'ص ' : 'p';
    const pages = r.printed_page_start === r.printed_page_end
      ? `${pageMark}${n(r.printed_page_start)}`
      : `${pageMark}${n(r.printed_page_start)}-${n(r.printed_page_end)}`;
    // THE SEPARATOR IS NOT COSMETIC ON AN URDU ROW. In Noto Nastaliq a middle
    // dot adjacent to an Extended Arabic-Indic digit renders AS A ZERO — `ص ۷-۸
    // · 🎬` reads as page 80, and `۲۸ ·` reads as 280 (measured on the NIETE
    // FICO card). Urdu rows use the Urdu comma; the dot is safe between words,
    // so English rows keep it.
    const sep = rtl ? '، ' : ' · ';
    // A video is a real reason to tap one row over another, so it is surfaced
    // rather than being a surprise inside the PDF.
    const video = r.yt && r.yt.url ? `${sep}🎬` : '';
    const kind = r.lp_type && r.lp_type !== 'content' ? `${sep}${r.lp_type.replace(/_/g, ' ')}` : '';

    const sub = r.subtopic_title || '';
    const menu = r.menu_title || sub;
    // 278 rows in the corpus carry the same string in menu_title and
    // subtopic_title. Printing it twice on one row is noise, not information.
    const body = sub && sub === r.menu_title ? '' : sub;
    // The kind marker ("end of chapter", "review") is a real reason to tap one
    // row over another, so it gets its room reserved instead of being appended
    // last and therefore always being the first thing the clip removes — 103
    // rows overflow this line (bd-3uiev).
    const budget = META_CAP - cps(lead);
    const meta = body ? `${clip(body, budget - cps(kind))}${kind}` : kind.slice(cps(sep));

    const mc = {
      title: clip(`${lead}${menu}`, TITLE_CAP),
      // The lead mark goes on an Urdu description too, or a row that opens with
      // `ص` is fine but one opening with a digit renders left-aligned.
      description: clip(`${lead}${pages}${video}`, DESC_CAP),
    };
    if (meta) mc.metadata = `${lead}${clip(meta, budget)}`;

    return {
      id: r.segment_id,
      'main-content': mc,
      // Only the segment id. Serving reads the row for everything else, so a
      // payload cannot drift out of step with the corpus.
      'on-click-action': {
        name: 'data_exchange',
        payload: { step: 'lp612_segment', segment_id: r.segment_id },
      },
    };
  });

  if (hasMore) {
    // The overflow row speaks the book's language too — K-5's `مزید اسباق ←`,
    // with the arrow pointing the direction of reading flow (bd-t8mbl). The
    // language comes from the rows themselves; an empty page has no More row.
    const moreRtl = !!(slice[0] || rows[0] || {}).language && (slice[0] || rows[0]).language === 'ur';
    items.push({
      id: MORE_ROW_ID,
      'main-content': moreRtl
        ? { title: clip(`${RLM}مزید اسباق ←`, TITLE_CAP), description: `${RLM}اگلا صفحہ` }
        : { title: clip('More lessons →', TITLE_CAP), description: 'Next page' },
      'on-click-action': {
        name: 'data_exchange',
        payload: {
          step: 'lp612_segment_page',
          grade: String(grade),
          subject,
          chapter_key: chapterKey,
          page: String(p + 1),
        },
      },
    });
  }

  return { items, hasMore, total, page: p };
}

// ── one segment ─────────────────────────────────────────────────────────────

/**
 * Deliberately NOT filtered by the religious hold.
 *
 * Serving has to be able to load a held segment in order to decline it with a
 * real sentence. Filtering here would turn "we are not serving this yet" into
 * "that lesson does not exist", which is both untrue and unactionable. The hold
 * is enforced in lp612-serving.service.js, on the row this returns.
 */
async function segmentById(segmentId) {
  const { data, error } = await supabase
    .from(TABLE)
    .select('*')
    .eq('segment_id', segmentId)
    .eq('is_current', true);
  if (error) {
    logToFile('LP 6-12 catalog: segment lookup failed', { segmentId, error: error.message });
    return null;
  }
  const rows = Array.isArray(data) ? data : (data ? [data] : []);
  return rows[0] || null;
}

module.exports = {
  buildGradeItems,
  buildSubjectItems,
  buildChapterItems,
  buildSegmentItems,
  segmentById,
  TABLE,
};
