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
const { clip, TITLE_CAP, DESC_CAP, META_CAP, PAGE_SIZE, MORE_ROW_ID } =
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
    const rows = await run(menuQuery('grade').eq('grade', g).limit(1), `grade ${g}`);
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
    menuQuery('subject, chapter_key, language').eq('grade', Number(grade)),
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

async function buildChapterItems(grade, subject) {
  const rows = await run(
    menuQuery('chapter_key, chapter_number, chapter_title, part, language, order_index')
      .eq('grade', Number(grade))
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

  return [...byChapter.entries()]
    .sort((a, b) => (a[1].number ?? 999) - (b[1].number ?? 999) || a[0].localeCompare(b[0]))
    .slice(0, PAGE_SIZE)
    .map(([chapterKey, e]) => {
      const n = (v) => (e.rtl ? urD(v) : String(v));
      const lead = e.rtl ? RLM : '';
      // The chapter's own printed number, then its own title. A book that
      // restarts numbering inside a part shows the part, because 'Chapter 1'
      // twice in one list is the collision the part-prefixed key exists for.
      const label = e.part ? `${e.part} · ${e.title || chapterKey}` : (e.title || chapterKey);
      return {
        id: chapterKey,
        'main-content': {
          title: clip(`${lead}${e.number != null ? `${n(e.number)}. ` : ''}${label}`, TITLE_CAP),
          description: clip(`${n(e.lessons)} lessons`, DESC_CAP),
        },
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
    menuQuery('segment_id, menu_title, subtopic_title, printed_page_start, printed_page_end, ' +
              'order_index, lp_type, language, yt')
      .eq('grade', Number(grade))
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
    const pages = r.printed_page_start === r.printed_page_end
      ? `p${n(r.printed_page_start)}`
      : `p${n(r.printed_page_start)}-${n(r.printed_page_end)}`;
    // A video is a real reason to tap one row over another, so it is surfaced
    // rather than being a surprise inside the PDF.
    const video = r.yt && r.yt.url ? ' · 🎬' : '';
    const kind = r.lp_type && r.lp_type !== 'content' ? ` · ${r.lp_type.replace(/_/g, ' ')}` : '';

    return {
      id: r.segment_id,
      'main-content': {
        title: clip(`${lead}${r.menu_title || r.subtopic_title}`, TITLE_CAP),
        description: clip(`${pages}${video}`, DESC_CAP),
        metadata: clip(`${r.subtopic_title || ''}${kind}`, META_CAP),
      },
      // Only the segment id. Serving reads the row for everything else, so a
      // payload cannot drift out of step with the corpus.
      'on-click-action': {
        name: 'data_exchange',
        payload: { step: 'lp612_segment', segment_id: r.segment_id },
      },
    };
  });

  if (hasMore) {
    items.push({
      id: MORE_ROW_ID,
      'main-content': { title: clip('More lessons →', TITLE_CAP), description: 'Next page' },
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
