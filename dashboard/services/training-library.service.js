'use strict';
/**
 * bd-s42dye.1 — the Training Library: the whole training catalogue, read-only, for coaches.
 *
 * A coach browses trainings, she does not take them. So nothing here is scoped to her: no assignment or band,
 * no level chain, no module order, no exam or certificate gate. Those decisions live behind
 * the bot's rules API (the dashboard's training-rules client), which this module never reaches. It also never writes: every
 * call is a SELECT, and the question reads never open an attempt (the existing exam routes insert one on open).
 *
 * Answer keys never leave: question rows are projected onto an explicit whitelist (QUESTION_FIELDS), so a key,
 * rubric or explanation cannot ride along by accident.
 *
 * Rules are the bot's own pure modules, required directly as portal.routes.js already does (no I/O, no requires
 * beyond a seeded shuffle): isaps-module-exam.rules (which exam quiz belongs to a module), isaps-crq-paper.rules
 * (what makes a question written), paper-marking.service (what makes it multi-answer), isaps-readings.rules.
 */
const { fetchAllPaged } = require('../lib/fetch-all-paged');
const { resolveMediaUrl, isPdfSourceUrl } = require('../lib/media-url');
const { isPerModuleQuiz, moduleSourceQuizId } = require('../../bot/shared/services/training/isaps-module-exam.rules');
const { isOpenEndedQuestion } = require('../../bot/shared/services/training/isaps-crq-paper.rules');
const { isMultiKey } = require('../../bot/shared/services/training/paper-marking.service');
const { parseOptionImages } = require('../../bot/shared/services/training/question-images.rules');
const { readingsForCourse } = require('../../bot/shared/services/training/isaps-readings.rules');

/** Vendors in the order a coach sees them; any other key follows alphabetically (TALEEMABAD_LEGACY lands here). */
const VENDOR_RANK = ['TALEEMABAD', 'ISAPS', 'BEACONHOUSE', 'OXBRIDGE'];

const EXAM_QUIZ_TYPES = ['grand_quiz', 'capstone'];
const MODULE_NO = /Module (\d+)/;

/** What a question may carry out of this module. Nothing else is ever copied. */
const QUESTION_FIELDS = ['id', 'type', 'text', 'options', 'image_url', 'option_image_urls'];

const vendorRank = (key) => {
  const i = VENDOR_RANK.indexOf(key);
  return i === -1 ? VENDOR_RANK.length : i;
};
const byOrder = (a, b) => (Number(a.order_index) - Number(b.order_index)) || (Number(a.id) - Number(b.id));
const compareVendors = (a, b) => (vendorRank(a.key) - vendorRank(b.key)) || String(a.key).localeCompare(String(b.key));

/** A path or query id for a bigint column: digits only, else null (the caller answers 404 or 400). */
function toId(value) {
  const s = String(value === undefined || value === null ? '' : value);
  return /^\d+$/.test(s) ? Number(s) : null;
}

function groupBy(rows, key) {
  const m = new Map();
  for (const r of rows) {
    const k = r[key];
    if (!m.has(k)) m.set(k, []);
    m.get(k).push(r);
  }
  return m;
}

/** Active rows only, one paged read per table (PostgREST caps a response at 1000 rows). */
const activeRows = (supabase, table, cols) => fetchAllPaged(
  () => supabase.from(table).select(cols).eq('is_active', true).order('id', { ascending: true }),
);

/** The level's own exam row: an active grand quiz or capstone that is not an ISAPS per-module quiz. */
function levelExamQuiz(quizzes, levelId) {
  return quizzes
    .filter((q) => q.level_id === levelId && EXAM_QUIZ_TYPES.includes(q.quiz_type) && !isPerModuleQuiz(q.source_quiz_id))
    .sort((a, b) => Number(a.id) - Number(b.id))[0] || null;
}

/** The ISAPS per-module exam row for a course titled "Module N": the active grand_quiz at 900+N on its level. */
function moduleExamQuiz(quizzes, course) {
  const m = MODULE_NO.exec((course && course.title) || '');
  if (!m) return null;
  const src = moduleSourceQuizId(parseInt(m[1], 10));
  return quizzes
    .filter((q) => q.level_id === course.level_id && Number(q.source_quiz_id) === src && q.quiz_type === 'grand_quiz')
    .sort((a, b) => Number(a.id) - Number(b.id))[0] || null;
}

/** GET /library — vendors → levels → courses → modules, in one read per table. */
async function loadLibrary(supabase) {
  const [vendors, levels, courses, modules, quizzes, questions] = await Promise.all([
    activeRows(supabase, 'training_vendors', 'id, key, name'),
    activeRows(supabase, 'training_levels', 'id, vendor_id, name, order_index'),
    activeRows(supabase, 'training_courses', 'id, level_id, title, course_type, order_index'),
    activeRows(supabase, 'training_modules', 'id, course_id, title, order_index, duration_seconds, video_url, audio_url, source_media_url'),
    activeRows(supabase, 'training_grand_quizzes', 'id, level_id, source_quiz_id, quiz_type'),
    activeRows(supabase, 'training_questions', 'training_module_id, grand_quiz_id'),
  ]);

  const moduleHasQuestions = new Set();
  const quizHasQuestions = new Set();
  for (const q of questions) {
    if (q.training_module_id !== null && q.training_module_id !== undefined) moduleHasQuestions.add(q.training_module_id);
    if (q.grand_quiz_id !== null && q.grand_quiz_id !== undefined) quizHasQuestions.add(q.grand_quiz_id);
  }
  const livingQuizzes = quizzes.filter((q) => quizHasQuestions.has(q.id));

  const levelsByVendor = groupBy(levels, 'vendor_id');
  const coursesByLevel = groupBy(courses, 'level_id');
  const modulesByCourse = groupBy(modules, 'course_id');

  return {
    vendors: [...vendors].sort(compareVendors).map((v) => ({
      vendor_key: v.key,
      vendor_name: v.name,
      levels: (levelsByVendor.get(v.id) || []).sort(byOrder).map((l) => {
        const exam = levelExamQuiz(livingQuizzes, l.id);
        return {
          id: l.id,
          name: l.name,
          order_index: l.order_index,
          has_level_exam: !!exam,
          exam_kind: exam ? exam.quiz_type : null,
          courses: (coursesByLevel.get(l.id) || []).sort(byOrder).map((c) => ({
            id: c.id,
            title: c.title,
            course_type: c.course_type,
            order_index: c.order_index,
            has_readings: hasReadings(v, l, c),
            has_module_exam: v.key === 'ISAPS' && !!moduleExamQuiz(livingQuizzes, c),
            modules: (modulesByCourse.get(c.id) || []).sort(byOrder).map((m) => ({
              id: m.id,
              title: m.title,
              order_index: m.order_index,
              duration_seconds: m.duration_seconds,
              has_video: !!m.video_url,
              has_audio: !!m.audio_url,
              has_pdf: isPdfSourceUrl(m.source_media_url),
              has_questions: moduleHasQuestions.has(m.id),
            })),
          })),
        };
      }),
    })),
  };
}

function readingsFor(vendor, level, course) {
  if (!vendor) return null;
  return readingsForCourse({
    vendorKey: vendor.key,
    levelOrderIndex: level.order_index,
    courseTitle: course.title,
  });
}

function hasReadings(vendor, level, course) {
  const r = readingsFor(vendor, level, course);
  return !!(r && (r.available.length || r.unavailable.length));
}

/** The course → level → vendor chain of an ACTIVE course, or null (also null when the level or vendor is inactive). */
async function courseChain(supabase, courseId) {
  const { data: course, error } = await supabase
    .from('training_courses').select('id, level_id, title').eq('id', courseId).eq('is_active', true).maybeSingle();
  if (error) throw error;
  if (!course) return null;
  const { data: level, error: le } = await supabase
    .from('training_levels').select('id, vendor_id, name, order_index').eq('id', course.level_id).eq('is_active', true).maybeSingle();
  if (le) throw le;
  if (!level) return null;
  const { data: vendor, error: ve } = await supabase
    .from('training_vendors').select('id, key, name').eq('id', level.vendor_id).eq('is_active', true).maybeSingle();
  if (ve) throw ve;
  if (!vendor) return null;
  return { course, level, vendor };
}

/** GET /library/module/:id — null when the module (or anything above it) is unknown or inactive. */
async function loadModule(supabase, moduleId) {
  const id = toId(moduleId);
  if (id === null) return null;
  const { data: m, error } = await supabase
    .from('training_modules')
    .select('id, title, content_html, video_url, audio_url, source_media_url, duration_seconds, course_id')
    .eq('id', id).eq('is_active', true).maybeSingle();
  if (error) throw error;
  if (!m) return null;
  const chain = await courseChain(supabase, m.course_id);
  if (!chain) return null;

  const pdfSource = isPdfSourceUrl(m.source_media_url) ? m.source_media_url : null;
  const [videoUrl, audioUrl, pdfUrl] = await Promise.all([
    resolveMediaUrl(m.video_url, 3600),
    resolveMediaUrl(m.audio_url, 3600),
    resolveMediaUrl(pdfSource, 3600),
  ]);
  const { data: probe, error: qe } = await supabase
    .from('training_questions').select('id').eq('training_module_id', id).eq('is_active', true).limit(1);
  if (qe) throw qe;

  return {
    id: m.id,
    title: m.title,
    course_id: m.course_id,
    level_id: chain.level.id,
    vendor_key: chain.vendor.key,
    // The same body the module route serves (the client sanitises it, as for the old screens); empty is null.
    body_html: m.content_html ? m.content_html : null,
    video_url: videoUrl,
    audio_url: audioUrl,
    pdf_url: pdfUrl,
    duration_seconds: m.duration_seconds,
    has_questions: (probe || []).length > 0,
  };
}

/** GET /library/course/:id/readings — null for an unknown or inactive course. */
async function loadReadings(supabase, courseId) {
  const id = toId(courseId);
  if (id === null) return null;
  const chain = await courseChain(supabase, id);
  if (!chain) return null;
  return readingsFor(chain.vendor, chain.level, chain.course) || { available: [], unavailable: [] };
}

/** One question, projected onto QUESTION_FIELDS. `writtenType` names an option-less question: 'crq' or 'open'. */
async function shapeQuestion(q, writtenType) {
  const images = parseOptionImages(q.option_images);
  const written = isOpenEndedQuestion({ options: q.options || [], option_images: images });
  let options = (Array.isArray(q.options) ? q.options : []).map((o) =>
    (typeof o === 'string' ? o : (o && typeof o === 'object' && typeof o.text === 'string' ? o.text : String(o === null || o === undefined ? '' : o))));
  if (!options.length && images.length) options = images.map((_, i) => `Option ${i + 1}`);
  const urls = await Promise.all(images.map((u) => resolveMediaUrl(u, 3600)));
  const optionImageUrls = options.map((_, i) => urls[i] || null);
  let type;
  if (written) type = writtenType;
  else type = isMultiKey(q.correct_option) ? 'msq' : 'mcq';
  const out = {
    id: q.id,
    type,
    text: q.question_text || '',
    options: written ? [] : options,
    image_url: null,
    option_image_urls: written ? [] : optionImageUrls,
  };
  // Defence in depth: the contract's keys and no others.
  return Object.fromEntries(QUESTION_FIELDS.map((k) => [k, out[k]]));
}

const BANK_COLUMNS = 'id, question_text, options, option_images, correct_option, order_index';

/** `correct_option` is read ONLY to tell a multi-answer question from a single one; shapeQuestion never copies it. */
async function readBank(supabase, column, value) {
  const { data, error } = await supabase
    .from('training_questions').select(BANK_COLUMNS).eq(column, value).eq('is_active', true)
    .order('order_index', { ascending: true });
  if (error) throw error;
  return [...(data || [])].sort(byOrder);
}

/**
 * GET /library/questions — scope is 'module' | 'level' | 'module_exam'. Returns null for an unknown/inactive
 * target (404); a module with no quiz is an empty bank, a level or course with no exam is null.
 */
async function loadQuestions(supabase, scope, rawId) {
  const id = toId(rawId);
  if (id === null) return null;

  if (scope === 'module') {
    const { data: m, error } = await supabase
      .from('training_modules').select('id, title, course_id').eq('id', id).eq('is_active', true).maybeSingle();
    if (error) throw error;
    if (!m || !(await courseChain(supabase, m.course_id))) return null;
    const bank = await readBank(supabase, 'training_module_id', id);
    return { scope, title: m.title, questions: await Promise.all(bank.map((q) => shapeQuestion(q, 'open'))) };
  }

  if (scope === 'level') {
    const { data: level, error } = await supabase
      .from('training_levels').select('id, vendor_id, name').eq('id', id).eq('is_active', true).maybeSingle();
    if (error) throw error;
    if (!level) return null;
    const { data: vendor, error: ve } = await supabase
      .from('training_vendors').select('id').eq('id', level.vendor_id).eq('is_active', true).maybeSingle();
    if (ve) throw ve;
    if (!vendor) return null;
    const { data: quizzes, error: qe } = await supabase
      .from('training_grand_quizzes').select('id, level_id, source_quiz_id, quiz_type')
      .eq('level_id', id).eq('is_active', true);
    if (qe) throw qe;
    // the first exam row WITH questions, as the catalogue reports it
    const candidates = (quizzes || []).filter((q) => EXAM_QUIZ_TYPES.includes(q.quiz_type) && !isPerModuleQuiz(q.source_quiz_id))
      .sort((a, b) => Number(a.id) - Number(b.id));
    for (const quiz of candidates) {
      // eslint-disable-next-line no-await-in-loop
      const bank = await readBank(supabase, 'grand_quiz_id', quiz.id);
      if (bank.length) {
        return { scope, title: level.name, questions: await Promise.all(bank.map((q) => shapeQuestion(q, 'open'))) };
      }
    }
    return null;
  }

  if (scope === 'module_exam') {
    const chain = await courseChain(supabase, id);
    if (!chain || chain.vendor.key !== 'ISAPS') return null;
    const { data: quizzes, error: qe } = await supabase
      .from('training_grand_quizzes').select('id, level_id, source_quiz_id, quiz_type')
      .eq('level_id', chain.course.level_id).eq('is_active', true);
    if (qe) throw qe;
    const quiz = moduleExamQuiz(quizzes || [], chain.course);
    if (!quiz) return null;
    const bank = await readBank(supabase, 'grand_quiz_id', quiz.id);
    if (!bank.length) return null;
    return { scope, title: chain.course.title, questions: await Promise.all(bank.map((q) => shapeQuestion(q, 'crq'))) };
  }

  return null;
}

module.exports = { loadLibrary, loadModule, loadReadings, loadQuestions, toId, VENDOR_RANK };
