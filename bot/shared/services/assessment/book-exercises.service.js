'use strict';
/**
 * AG row 21 (Hafsa, 1 Oct; Amena 21 Nov: a tick-list) — a chapter's own exercise questions, so the teacher
 * can see them and tick the ones she wants on her paper.
 *
 * Schema-first: no new table. The questions are read out of the chapter's page text the generator already
 * uses (book-content.service), by one model call per chapter, and every question is checked against that
 * page text so nothing the model invented reaches her. The list is cached per book + chapter in Redis,
 * so the model runs once per chapter, not once per teacher.
 *
 * Heavy dependencies are required inside the functions: the pure parser is tested on its own.
 */

const CACHE_VERSION = 'v1';
const CACHE_TTL_SECONDS = 30 * 24 * 3600;
const MAX_CHAPTERS = 12;
const MAX_OUTPUT_TOKENS = 12000;
const URDU_MEDIUM = new Set(['urdu', 'islamiat', 'genk', 'sst', 'general_knowledge', 'social_studies']);

/** Letters and digits only, any script, lowercased: what survives OCR spacing and punctuation. */
const squash = (s) => String(s || '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');
const words = (s) => String(s || '').toLowerCase().match(/[\p{L}\p{N}]+/gu) || [];

/** The question is on the pages: whole, or (for OCR slips) nearly every one of its words. */
function printedOn(text, pages, pageWords) {
  const t = squash(text);
  if (t.length < 3) return false;
  if (pages.includes(t)) return true;
  const w = words(text);
  if (w.length < 4) return false;
  return w.filter((x) => pageWords.has(x)).length / w.length >= 0.9;
}

/**
 * The model's reply → the list she sees. Keeps only questions printed on the pages, in the model's (book)
 * order; a type the subject does not offer becomes its first written type.
 */
function parseExercises(reply, pageContent, types) {
  const list = reply && Array.isArray(reply.exercises) ? reply.exercises : [];
  const offered = (types || []).filter((t) => t.category !== 'board');
  const ids = offered.map((t) => t.id);
  const fallback = (offered.find((t) => t.category === 'subjective') || offered[0] || {}).id || null;
  const pages = squash(pageContent);
  const pageWords = new Set(words(pageContent));
  const out = [];
  const kept = new Set();
  for (const e of list) {
    const text = typeof e?.text === 'string' ? e.text.trim() : '';
    if (!text || !printedOn(text, pages, pageWords)) continue;
    if (kept.has(squash(text))) continue;
    kept.add(squash(text));
    const heading = typeof e.heading === 'string' && e.heading.trim() ? e.heading.trim() : null;
    const number = e.number != null && String(e.number).trim() ? String(e.number).trim() : null;
    const ref = [heading, number ? `Q${number}` : null].filter(Boolean).join(' · ') || `Q${out.length + 1}`;
    const type = ids.includes(e.type) ? e.type : fallback;
    if (!type) continue;
    out.push({ ref, heading, text, type, page: Number.isInteger(e.page) ? e.page : null });
  }
  return out;
}

function prompt(types) {
  return 'You read a school textbook chapter and list ITS OWN exercise questions: the questions printed for '
    + 'pupils to answer (exercises, review questions, practice, "answer these", activities that ask a question). '
    + 'Not worked examples, not the lesson text, not headings.\n'
    + 'Copy each question exactly as printed, in the book\'s own language and script. An MCQ keeps its options '
    + 'in the same text. A numbered question with parts (a), (b) … is one question per part, each with the shared '
    + 'instruction in front.\n'
    + `Give each one the closest of these types: ${types.map((t) => t.id).join(', ')}.\n`
    + 'Reply with JSON only: {"exercises":[{"heading":"<exercise heading as printed>","number":"<its number>",'
    + '"text":"<the question>","type":"<one type above>","page":<page number from the === Page N === marker>}]}, '
    + 'in book order. If the chapter has no exercise questions, reply {"exercises":[]}.';
}

async function readChapter({ grade, subject, chapterNumber, curriculum }) {
  const BookContent = require('./book-content.service');
  let source;
  try {
    source = await BookContent.loadChapterContent({ grade, subject, chapterNumber, ...(curriculum ? { curriculum } : {}) });
  } catch (err) {
    if (err && (err.code === 'NO_CONTENT' || err.code === 'CHAPTER_NOT_FOUND')) {
      return { chapterNumber, title: err.chapterTitle || null, exercises: [], empty: true };
    }
    throw err;
  }
  const types = require('./question-types').forSubject(subject, grade).filter((t) => t.category !== 'board');
  const { getClient } = require('../llm-client');
  const { resolveModelForJob } = require('../../config/model-registry');
  const family = URDU_MEDIUM.has(String(subject).toLowerCase()) ? 'urdu' : 'eng';
  const model = resolveModelForJob('assessment.generate', { family }).model;
  const response = await getClient().chat.completions.create({
    model,
    job: 'assessment.generate',
    messages: [
      { role: 'system', content: prompt(types) },
      { role: 'user', content: `Grade ${grade} ${subject}, chapter ${chapterNumber}: ${source.chapterTitle || ''}\n\n${source.content}` },
    ],
    temperature: 0,
    response_format: { type: 'json_object' },
    max_tokens: MAX_OUTPUT_TOKENS,
  });
  const raw = response?.choices?.[0]?.message?.content || '';
  const { extractJsonFromResponse } = require('./assessment-json.util');
  const reply = extractJsonFromResponse(raw);
  return { chapterNumber, title: source.chapterTitle || null, exercises: parseExercises(reply, source.content, types) };
}

const cacheKey = ({ grade, subject, chapterNumber, curriculum }) =>
  `assessment:exercises:${CACHE_VERSION}:${curriculum || 'ict'}:${grade}:${String(subject).toLowerCase()}:${chapterNumber}`;

async function chapterExercises(args) {
  const Cache = require('../cache/railway-redis.service');
  const { logToFile } = require('../../utils/logger');
  const key = cacheKey(args);
  try {
    const hit = await Cache.get(key);
    const value = typeof hit === 'string' ? JSON.parse(hit) : hit;
    if (value && Array.isArray(value.exercises)) return { chapterNumber: args.chapterNumber, title: value.title ?? null, exercises: value.exercises };
  } catch (err) {
    logToFile('[assessment] exercises cache read failed', { key, error: err.message });
  }
  const started = Date.now();
  const chapter = await readChapter(args);
  logToFile('[assessment] exercises read', { key, count: chapter.exercises.length, empty: !!chapter.empty, ms: Date.now() - started });
  // An empty chapter (no text yet) is not cached: the import may fill it later.
  if (!chapter.empty) await Cache.set(key, { title: chapter.title, exercises: chapter.exercises }, CACHE_TTL_SECONDS);
  return { chapterNumber: chapter.chapterNumber, title: chapter.title, exercises: chapter.exercises };
}

/** Her chapters' exercise questions, chapters in book order, each chapter read once. */
async function listExercises({ grade, subject, chapterNumbers, curriculum = null }) {
  const chapters = [...new Set((chapterNumbers || []).map(Number).filter(Number.isInteger))].sort((a, b) => a - b).slice(0, MAX_CHAPTERS);
  const out = await Promise.all(chapters.map((chapterNumber) => chapterExercises({ grade, subject, chapterNumber, curriculum })));
  return { chapters: out };
}

module.exports = { listExercises, parseExercises, MAX_CHAPTERS };
