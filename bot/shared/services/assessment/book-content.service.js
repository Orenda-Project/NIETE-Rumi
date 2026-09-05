'use strict';
/**
 * Textbook prose, fetched and assembled for the generator.
 *
 * A teacher says what she wants in one of two ways — a chapter off the contents
 * page, or page numbers she read off the book — and both end here, in the same
 * output: her pages, in order, each behind a `=== Page N ===` marker. That
 * format is not decoration. It is what the generation prompts were written
 * against, so the model can attribute a question to a page.
 *
 * Content comes from our own tables, filled by
 * `scripts/assessment/import-ict-textbooks.py`. Nothing here reaches the upstream
 * platform at request time — the import already ran.
 *
 * Page numbers throughout are the PRINTED ones — the number on the page, which
 * is what a teacher means. The PDF index differs by the book's front matter and
 * is stored but never used for lookup.
 */

const supabase = require('../../config/supabase');
const { logToFile } = require('../../utils/logger');

const CURRICULUM = 'ict';

// The Flow speaks in short codes; the tables speak in the `subjects` lookup's
// canonical values. One map, applied at the boundary, so a book can never be
// filed under both "Maths" and "maths".
const SUBJECT_CODES = {
  eng: 'english', english: 'english',
  urdu: 'urdu',
  maths: 'maths', math: 'maths', mathematics: 'maths',
  islamiat: 'islamiat',
  science: 'science', gensci: 'science',
  genk: 'general_knowledge', general_knowledge: 'general_knowledge',
  sst: 'social_studies', social_studies: 'social_studies',
};

function fail(code, message, extra = {}) {
  const err = new Error(message);
  err.code = code;
  Object.assign(err, extra);
  return err;
}

function normaliseSubject(subject) {
  return SUBJECT_CODES[String(subject || '').trim().toLowerCase()] || null;
}

/**
 * "10, 3, 5-7" -> [3, 5, 6, 7, 10]. Sorted and deduped, because she may well
 * type a page twice and should not be handed it twice.
 */
function parsePageRanges(input) {
  const raw = String(input || '').trim();
  if (!raw) throw fail('INVALID_PAGE_RANGE', 'No pages given.');

  const pages = new Set();
  for (const part of raw.split(',').map((p) => p.trim()).filter(Boolean)) {
    const range = part.match(/^(\d+)\s*-\s*(\d+)$/);
    if (range) {
      const lo = Number(range[1]);
      const hi = Number(range[2]);
      if (lo < 1 || hi < 1) throw fail('INVALID_PAGE_RANGE', `Pages start at 1: "${part}".`);
      if (lo > hi) throw fail('INVALID_PAGE_RANGE', `"${part}" runs backwards.`);
      for (let p = lo; p <= hi; p += 1) pages.add(p);
      continue;
    }
    if (/^\d+$/.test(part)) {
      const p = Number(part);
      if (p < 1) throw fail('INVALID_PAGE_RANGE', 'Pages start at 1.');
      pages.add(p);
      continue;
    }
    throw fail('INVALID_PAGE_RANGE', `"${part}" is not a page number or a range.`);
  }
  if (pages.size === 0) throw fail('INVALID_PAGE_RANGE', 'No pages given.');
  return [...pages].sort((a, b) => a - b);
}

/** The book row, or a typed refusal naming what we could not find. */
async function _book(grade, subject) {
  const code = normaliseSubject(subject);
  if (!code) {
    throw fail('BOOK_NOT_FOUND', `We do not have a ${subject} book.`, { grade, subject });
  }
  const { data, error } = await supabase
    .from('textbooks')
    .select('id, total_pages, pdf_page_offset')
    .eq('curriculum', CURRICULUM)
    .eq('grade', Number(grade))
    .eq('subject', code)
    .maybeSingle();

  if (error) {
    logToFile('[assessment] textbook lookup failed', { grade, subject: code, error: error.message });
    throw fail('BOOK_NOT_FOUND', 'Could not look up that book.', { grade, subject: code });
  }
  if (!data) {
    throw fail('BOOK_NOT_FOUND', `We do not have the Grade ${grade} ${subject} book yet.`,
      { grade, subject: code });
  }
  return data;
}

/** Fetch page rows for a set of printed page numbers, in reading order. */
async function _pages(textbookId, pageNumbers) {
  const { data, error } = await supabase
    .from('textbook_pages')
    .select('textbook_page_number, page_content')
    .eq('textbook_id', textbookId)
    .in('textbook_page_number', pageNumbers)
    .order('textbook_page_number');

  if (error) {
    logToFile('[assessment] page fetch failed', { textbookId, error: error.message });
    throw fail('NO_CONTENT', 'Could not read that book.');
  }
  return (data || []).filter((p) => (p.page_content || '').trim());
}

/**
 * The one output format. Page markers included so a generated question can cite
 * where it came from, and so a model that loses its place has an anchor.
 */
function _assemble(rows) {
  return rows
    .map((p) => `=== Page ${p.textbook_page_number} ===\n${p.page_content.trim()}`)
    .join('\n\n');
}

/** What the chapter picker offers her. */
async function listChapters({ grade, subject }) {
  const book = await _book(grade, subject);
  const { data, error } = await supabase
    .from('textbook_toc')
    .select('chapter_number, chapter_title, page_start, page_end')
    .eq('textbook_id', book.id)
    .order('chapter_number');

  if (error) {
    logToFile('[assessment] chapter list failed', { grade, subject, error: error.message });
    throw fail('BOOK_NOT_FOUND', 'Could not read the contents of that book.');
  }
  return (data || []).map((c) => ({
    chapterNumber: c.chapter_number,
    title: c.chapter_title,
    pageStart: c.page_start,
    pageEnd: c.page_end,
    pageCount: (c.page_start != null && c.page_end != null)
      ? (c.page_end - c.page_start + 1)
      : null,
  }));
}

/** Everything one chapter says. The path a teacher takes by default. */
async function loadChapterContent({ grade, subject, chapterNumber }) {
  const book = await _book(grade, subject);

  const { data: chapter, error } = await supabase
    .from('textbook_toc')
    .select('chapter_number, chapter_title, page_start, page_end')
    .eq('textbook_id', book.id)
    .eq('chapter_number', Number(chapterNumber))
    .maybeSingle();

  if (error || !chapter) {
    throw fail('CHAPTER_NOT_FOUND', `That book has no chapter ${chapterNumber}.`,
      { grade, subject, chapterNumber });
  }

  const wanted = [];
  for (let p = chapter.page_start; p <= chapter.page_end; p += 1) wanted.push(p);
  const rows = await _pages(book.id, wanted);

  if (rows.length === 0) {
    // The chapter is listed but its pages carry no text. Real: some books have
    // chapter rows the OCR never reached.
    throw fail('NO_CONTENT', `We do not have the text for "${chapter.chapter_title}" yet.`,
      { grade, subject, chapterNumber, chapterTitle: chapter.chapter_title });
  }

  return {
    content: _assemble(rows),
    pageReference: `${chapter.page_start}-${chapter.page_end}`,
    chapterNumber: chapter.chapter_number,
    chapterTitle: chapter.chapter_title,
    pageCount: rows.length,
    pagesFound: rows.map((p) => p.textbook_page_number),
  };
}

/** Exactly the pages she typed. The escape hatch from the chapter list. */
async function loadPageRangeContent({ grade, subject, pageRanges }) {
  const book = await _book(grade, subject);
  const wanted = parsePageRanges(pageRanges);

  // Say the range is wrong before fetching nothing and blaming the content —
  // "this book has pages 1-166" is a fixable answer, "no content" is not.
  const total = book.total_pages;
  const beyond = total ? wanted.filter((p) => p > total) : [];
  if (beyond.length > 0) {
    throw fail('PAGE_OUT_OF_RANGE',
      `This book has pages 1-${total}. You asked for ${beyond.join(', ')}.`,
      { totalPages: total, requested: wanted, beyond });
  }

  const rows = await _pages(book.id, wanted);
  if (rows.length === 0) {
    throw fail('NO_CONTENT', 'There is no text on those pages.', { requested: wanted });
  }

  const found = rows.map((p) => p.textbook_page_number);
  return {
    content: _assemble(rows),
    pageReference: String(pageRanges).trim(),
    pageCount: rows.length,
    pagesFound: found,
    pagesMissing: wanted.filter((p) => !found.includes(p)),
  };
}

module.exports = {
  listChapters,
  loadChapterContent,
  loadPageRangeContent,
  parsePageRanges,
  normaliseSubject,
};
