'use strict';
/**
 * Reading a curriculum matrix (Amena's GB Curriculum Matrix) into what NIETE serves (bd-97daxo.14, .5).
 *
 * Pure: a workbook from workbook.js in, plain data out. Nothing here touches the network, R2 or a database.
 *
 * BY HEADER, NEVER BY POSITION. Every tab is found by its name and every column by its header label, on the first
 * row that holds all the labels asked for. A tab or label that is not there stops the run with an error naming
 * it — the sheet is living, and a silent "0 lessons" is worse than a loud stop.
 *
 * THE KEY IS THE SEGMENT ID. gb_g1_english.c01.s001 → lesson gb_g1_english_ch1_seg1 (cR1 → chR1, c101 → ch101,
 * s995 → seg995). The subject tabs carry the LP PDF links but no Segment ID column, so a day row joins All Segments
 * on (subject, grade, Day #) — and the PDF's own filename (g1_ch1_English_seg1_…) must agree with the id it joined
 * to, or the row is a blocker and nothing of it is uploaded.
 */
const { buildRow, pagesLabel } = require('../build-lp-catalog');

const TITLE_CAP = 30;

const text = (cell) => (cell && cell.v != null ? String(cell.v).trim() : '');
const clip = (s, n) => { const c = [...String(s)]; return c.length <= n ? c.join('') : `${c.slice(0, n - 1).join('')}…`; };

function tab(workbook, name) {
  const rows = workbook && workbook.tabs && workbook.tabs[name];
  if (!rows) {
    const have = Object.keys((workbook && workbook.tabs) || {}).map((t) => `"${t}"`).join(', ');
    throw new Error(`sheet tab "${name}" not found (tabs: ${have}) — was it renamed?`);
  }
  return rows;
}

/** The first row holding every label; the column of each. Throws naming the labels that are missing. */
function header(rows, labels, tabName) {
  for (let i = 0; i < Math.min(rows.length, 25); i += 1) {
    const cols = {};
    rows[i].forEach((c, j) => { const t = text(c); if (t && !(t in cols)) cols[t] = j; });
    if (labels.every((l) => l in cols)) return { index: i, col: cols };
  }
  throw new Error(`sheet tab "${tabName}": no header row with ${labels.map((l) => `"${l}"`).join(', ')} — was a header renamed?`);
}

// ── ids ─────────────────────────────────────────────────────────────────────

const SEG_ID = /^([a-z][a-z0-9_]*)\.c(R?)(\d+)\.s(\d+)$/i;

function parseSegmentId(id) {
  const m = SEG_ID.exec(String(id || '').trim());
  if (!m) throw new Error(`not a Segment ID: "${id}" (expected like gb_g1_english.c01.s001)`);
  const chapter = m[2] ? `R${Number(m[3])}` : Number(m[3]);
  return { book_key: m[1].toLowerCase(), chapter, segment_index: Number(m[4]) };
}

/** gb_g1_english.c01.s001 → gb_g1_english_ch1_seg1 */
function lessonIdFor(segmentId) {
  const p = parseSegmentId(segmentId);
  return `${p.book_key}_ch${p.chapter}_seg${p.segment_index}`;
}

/** A review chapter: GB English's R1..R4, GB Urdu's جائزہ units 101.. */
const isReview = (chapter) => typeof chapter === 'string' || Number(chapter) >= 100;

const num = (v) => { const n = Number(v); return Number.isFinite(n) ? n : null; };
const gradeOf = (v) => num(v);
const dayOf = (v) => num(v);

/** "1-2" → [1, 2]; "9, 11" → [9, 11]; "19-28" → 19..28. Non-numbers dropped. */
function parsePages(v) {
  const out = [];
  for (const part of String(v == null ? '' : v).split(/[,;]/)) {
    const m = /^\s*(\d+)\s*(?:[-–]\s*(\d+))?\s*$/.exec(part);
    if (!m) continue;
    const a = Number(m[1]);
    const b = m[2] ? Number(m[2]) : a;
    for (let p = a; p <= Math.min(b, a + 300); p += 1) out.push(p);
  }
  return [...new Set(out)].sort((x, y) => x - y);
}

// ── the PDF links ───────────────────────────────────────────────────────────

/** The 8-hex content hash directory in Amena's R2 URLs (…/renders/49b5e94c/…): sha1(bytes)[0:8]. */
function urlHash(url) {
  const segs = String(url || '').split('?')[0].split('/');
  for (let i = segs.length - 2; i >= 0; i -= 1) if (/^[0-9a-f]{8}$/.test(segs[i])) return segs[i];
  return null;
}

const FILE = /^g(\d+)_ch(R?\d+)_([A-Za-z]+)_seg(\d+)(.*)\.pdf$/i;

function fileOf(url) {
  let base = String(url || '').split('?')[0].split('/').pop() || '';
  try { base = decodeURIComponent(base); } catch (_) { /* keep it raw */ }
  return base;
}

/** "_v9_gbfix_5Nov.pdf" → gb_v9_gbfix_5Nov; ".worksheet.pdf" → gb_worksheet; ".answer_key.pdf" → gb_answer_key. */
function versionStamp(prefix, rest) {
  const s = String(rest || '').replace(/^[._]+/, '').replace(/[^A-Za-z0-9_]+/g, '_').replace(/_+$/, '');
  return s ? `${prefix}_${s}` : prefix;
}

/** Does this filename name the same lesson as the segment? A reason string when not. */
function filenameMismatch(file, seg, cfgSubject) {
  const m = FILE.exec(file);
  if (!m) return `filename "${file}" is not g<grade>_ch<chapter>_<Subject>_seg<n>…pdf`;
  const [, g, ch, subj, s] = m;
  const want = `g${seg.grade}_ch${seg.chapter}_${cfgSubject.file}_seg${seg.segment_index}`;
  const got = `g${Number(g)}_ch${/^R/i.test(ch) ? `R${Number(ch.slice(1))}` : Number(ch)}_${subj}_seg${Number(s)}`;
  return got.toLowerCase() === want.toLowerCase() ? null : `filename "${file}" names ${got}, the row is ${want}`;
}

// ── reading ─────────────────────────────────────────────────────────────────

/**
 * Read the whole matrix.
 * @returns {{ segments: Map, items: Array, pending: Array, blockers: Array, chapterTitles: Map,
 *            skillLabels: Map, books: Array }}
 *   items    — one per linked PDF that joined cleanly: { lesson_id, asset_kind, url, url_hash, version_stamp, … }
 *   pending  — day rows with no PDF link yet (a label such as "v9 design pending")
 *   blockers — rows that cannot be served as they stand: no segment for the day, a filename that disagrees,
 *              a duplicate id, a URL with no content hash
 */
function read(workbook, cfg) {
  const blockers = [];

  // All Segments: the ids and everything about each day.
  const segRows = tab(workbook, cfg.segmentsTab);
  const sh = header(segRows, ['Segment ID', 'Subject', 'Grade', 'Chapter', 'Day #', 'Topic', 'Skill Type', 'Pages'], cfg.segmentsTab);
  const segments = new Map();
  const byDay = new Map();
  for (const row of segRows.slice(sh.index + 1)) {
    const id = text(row[sh.col['Segment ID']]);
    if (!id) continue;
    let p;
    try { p = parseSegmentId(id); } catch (err) { blockers.push({ tab: cfg.segmentsTab, segment_id: id, reason: err.message }); continue; }
    if (segments.has(id)) { blockers.push({ tab: cfg.segmentsTab, segment_id: id, reason: 'duplicate Segment ID (one row per id)' }); continue; }
    const seg = {
      segment_id: id,
      lesson_id: lessonIdFor(id),
      ...p,
      subject: text(row[sh.col.Subject]),
      grade: gradeOf(row[sh.col.Grade] && row[sh.col.Grade].v),
      day: dayOf(row[sh.col['Day #']] && row[sh.col['Day #']].v),
      topic: text(row[sh.col.Topic]),
      skill: text(row[sh.col['Skill Type']]),
      pages: parsePages(row[sh.col.Pages] && row[sh.col.Pages].v),
    };
    segments.set(id, seg);
    const k = `${seg.subject}|${seg.grade}|${seg.day}`;
    if (byDay.has(k)) blockers.push({ tab: cfg.segmentsTab, segment_id: id, reason: `two ids for ${seg.subject} grade ${seg.grade} day ${seg.day}` });
    else byDay.set(k, seg);
  }

  // Skill Taxonomy: the row title of each lesson ("Phonics", "الفاظ معانی").
  const skillLabels = new Map();
  if (cfg.skillsTab) {
    const rows = tab(workbook, cfg.skillsTab);
    const h = header(rows, ['Subject', 'Code', 'Skill type'], cfg.skillsTab);
    for (const row of rows.slice(h.index + 1)) {
      const code = text(row[h.col.Code]);
      if (code) skillLabels.set(`${text(row[h.col.Subject])}|${code}`, text(row[h.col['Skill type']]));
    }
  }

  // Subject tabs: the PDF links, and the chapter titles on the "Ch N — title" bands.
  const items = [];
  const pending = [];
  const chapterTitles = new Map();
  for (const [tabName, subject] of Object.entries(cfg.subjectTabs)) {
    const rows = tab(workbook, tabName);
    const h = header(rows, ['Day #', 'LP PDF'], tabName);
    const cs = cfg.subjects[subject];
    if (!cs) throw new Error(`config: subject "${subject}" (tab "${tabName}") has no entry in subjects`);
    let grade = null;
    for (const row of rows.slice(h.index + 1)) {
      const first = row[h.col['Day #']];
      const t = text(first);
      const band = /^GRADE\s+(\d+)/i.exec(t);
      if (band) { grade = Number(band[1]); continue; }
      const chBand = /^Ch\s+(R?\d+)\s*[—–-]\s*(.+)$/i.exec(t);
      if (chBand) {
        const ck = /^R/i.test(chBand[1]) ? `R${Number(chBand[1].slice(1))}` : Number(chBand[1]);
        chapterTitles.set(`${subject}|${grade}|${ck}`, chBand[2].trim());
        continue;
      }
      const day = typeof (first && first.v) === 'number' ? first.v : null;
      if (day === null) continue;
      const seg = byDay.get(`${subject}|${grade}|${day}`);
      const lp = row[h.col['LP PDF']];
      if (!seg) {
        if (lp && lp.link) blockers.push({ tab: tabName, grade, day, reason: 'no segment in All Segments for this grade and Day #', url: lp.link });
        continue;
      }
      const linked = [['lesson', lp]];
      if ('Answer key' in h.col) linked.push(['answer_key', row[h.col['Answer key']]]);
      let any = false;
      for (const [kind, cell] of linked) {
        if (!cell || !cell.link) continue;
        any = true;
        const url = cell.link;
        const file = fileOf(url);
        const mismatch = filenameMismatch(file, seg, cs);
        const hash = urlHash(url);
        if (mismatch || !hash) {
          blockers.push({ tab: tabName, grade, day, segment_id: seg.segment_id, asset_kind: kind, url,
            reason: mismatch || 'no 8-hex content hash in the URL' });
          continue;
        }
        const m = FILE.exec(file);
        items.push({
          lesson_id: seg.lesson_id, segment_id: seg.segment_id, book_key: seg.book_key, asset_kind: kind,
          url, url_hash: hash, file, version_stamp: versionStamp(cfg.bookPrefix, m ? m[5] : ''),
        });
      }
      if (!any) pending.push({ segment_id: seg.segment_id, lesson_id: seg.lesson_id, tab: tabName, grade, day, note: text(lp) });
    }
  }

  // Books: which books GB uses (slice 1 its own, slice 2 ICT's).
  const books = [];
  if (cfg.booksTab) {
    const rows = tab(workbook, cfg.booksTab);
    const h = header(rows, ['Slice', 'Subject', 'Grade'], cfg.booksTab);
    for (const row of rows.slice(h.index + 1)) {
      const slice = num(row[h.col.Slice] && row[h.col.Slice].v);
      const g = num(row[h.col.Grade] && row[h.col.Grade].v);
      const subject = text(row[h.col.Subject]);
      if (slice && g && subject) books.push({ slice, subject, grade: g });
    }
  }

  return { segments, items, pending, blockers, chapterTitles, skillLabels, books };
}

// ── the catalog books ───────────────────────────────────────────────────────

const stripGloss = (label) => String(label || '').replace(/\s*\([^)]*\)\s*$/, '').trim();
const humanise = (code) => String(code || '').replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase());
const urDigits = (s) => String(s).replace(/[0-9]/g, (d) => '۰۱۲۳۴۵۶۷۸۹'[Number(d)]);

function lpTypeOf(segmentIndex) {
  if (segmentIndex === 995) return 'assessment';
  if (segmentIndex === 990 || segmentIndex >= 900) return 'revision';
  return 'content';
}
function dayLabel(segmentIndex, type) {
  if (type === 'assessment') return 'Worksheet';
  if (type === 'revision') return 'Revision';
  return `Day ${segmentIndex}`;
}
function dayLabelRtl(segmentIndex, type) {
  if (type === 'assessment') return 'ورک شیٹ';
  if (type === 'revision') return 'اعادہ';
  return `دن ${urDigits(segmentIndex)}`;
}

/**
 * The GB books as lp_catalog.json books: the same shape as ICT's (so every surface reads them unchanged), plus
 * book_key, publisher, language and opt_in. Chapters and lessons in the sheet's teaching order (Day #), so a
 * review chapter sits after the unit it reviews. Deterministic: the same sheet gives byte-identical JSON.
 */
function catalogBooks(m, cfg) {
  const subjectOf = new Map(Object.entries(cfg.subjects).map(([name, s]) => [name, s]));
  const byBook = new Map();
  for (const seg of m.segments.values()) {
    if (!seg.book_key.startsWith(`${cfg.bookPrefix}_`)) continue;
    if (!byBook.has(seg.book_key)) byBook.set(seg.book_key, []);
    byBook.get(seg.book_key).push(seg);
  }
  const books = [];
  for (const [bookKey, segs] of byBook) {
    const first = segs[0];
    const cs = subjectOf.get(first.subject);
    if (!cs) throw new Error(`config: no subject entry for "${first.subject}" (book ${bookKey})`);
    const rtl = Boolean(cs.rtl);
    segs.sort((a, b) => (a.day - b.day) || (a.segment_index - b.segment_index));
    const chapters = new Map();
    for (const seg of segs) {
      const k = String(seg.chapter);
      if (!chapters.has(k)) chapters.set(k, { number: seg.chapter, segs: [] });
      chapters.get(k).segs.push(seg);
    }
    const outChapters = [...chapters.values()].map(({ number, segs: cSegs }) => {
      const review = isReview(number);
      const fallback = review ? `Review ${typeof number === 'string' ? number.slice(1) : number - 100}` : `Chapter ${number}`;
      const title = m.chapterTitles.get(`${first.subject}|${first.grade}|${number}`) || fallback;
      const lessons = cSegs.map((seg) => {
        const type = lpTypeOf(seg.segment_index);
        const raw = m.skillLabels.get(`${seg.subject}|${seg.skill}`);
        const section = stripGloss(raw) || humanise(seg.skill);
        const label = rtl ? dayLabelRtl(seg.segment_index, type) : dayLabel(seg.segment_index, type);
        const row = buildRow({ segment_index: seg.segment_index, section, topic: seg.topic, pages: seg.pages }, { rtl, label });
        return {
          lesson_id: seg.lesson_id,
          segment_index: seg.segment_index,
          lp_type: type,
          day_label: dayLabel(seg.segment_index, type),
          section,
          section_short: row.title,
          topic: seg.topic,
          topic_short: row.lead,
          pages: seg.pages,
          pages_label: pagesLabel(seg.pages),
          row: { title: row.title, description: row.description, metadata: row.metadata },
        };
      });
      return {
        number,
        title,
        title_short: clip(title, TITLE_CAP),
        pages_label: pagesLabel(cSegs.flatMap((s) => s.pages)),
        ...(review ? { review: true } : {}),
        lessons,
      };
    });
    books.push({
      stem: bookKey,
      grade: first.grade,
      subject: cs.subject,
      subject_key: cs.subject_key,
      rtl,
      book_key: bookKey,
      publisher: cfg.publisher || null,
      language: cs.language || (rtl ? 'ur' : 'en'),
      opt_in: true,
      chapters: outChapters,
    });
  }
  return books.sort((a, b) => (a.grade - b.grade) || a.subject_key.localeCompare(b.subject_key) || a.stem.localeCompare(b.stem));
}

/**
 * The region's book list, from the Books tab: slice 1 → GB's own book (gb_g<grade>_<slug>), whether or not it is
 * segmented yet (a book with no lessons simply shows nothing); slice 2 → ICT's book of that grade and subject key.
 * @param {Array} ictBooks the catalog's default list (stem, grade, subject_key)
 */
function bookKeys(m, cfg, ictBooks) {
  const own = [];
  const ict = [];
  const missing = [];
  for (const b of m.books) {
    if (b.slice === 1) {
      const cs = cfg.subjects[b.subject];
      if (!cs) throw new Error(`Books tab: slice 1 subject "${b.subject}" has no entry in the config's subjects`);
      own.push(`${cfg.bookPrefix}_g${b.grade}_${cs.slug}`);
    } else {
      const key = cfg.slice2[b.subject];
      if (!key) throw new Error(`Books tab: slice ${b.slice} subject "${b.subject}" has no entry in the config's slice2`);
      const book = (ictBooks || []).find((x) => x.grade === b.grade && x.subject_key === key);
      if (book) ict.push(book.book_key || book.stem); else missing.push(`${b.subject} G${b.grade}`);
    }
  }
  if (missing.length) bookKeys.lastMissing = missing;
  return [...new Set([...own, ...ict])];
}

module.exports = {
  read, catalogBooks, bookKeys, lessonIdFor, parseSegmentId, parsePages, urlHash, versionStamp, isReview, header, tab,
};
