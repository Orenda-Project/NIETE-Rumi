'use strict';
/**
 * bd-fmf24g.30 — "Send on WhatsApp" from a portal screen (the ShareActions kit button). ONE entry, `sendShare`,
 * behind POST /api/internal/share/send (routes/internal-share.routes.js) ← POST /api/portal/share/whatsapp.
 *
 * RULES
 *  - TEMPLATE ONLY. Meta prices every message and there is no free window, so a free-form send buys nothing and fails
 *    outside the 24 h window. She is already in the app when she taps Send, so the message is the file itself and one
 *    or two short lines: no button back to the app, no link token.
 *  - THE REAL RESULT. `sent` only when Meta accepted it; `failed` when it refused (retry may work); `unavailable` when
 *    this deployment has no template for the kind, Meta says the template is missing/paused/disabled, or the item is of a
 *    kind this send does not cover. Never a "sent" that did not happen (cf. bd-fmf24g.36).
 *  - NO DEFAULT TEMPLATE NAMES. The name comes from env, per deployment (templates are per WABA, and each env has its own
 *    approval). `WHATSAPP_SHARE_TEMPLATE_{LESSON,PAPER,DC,OBSERVATION}`; unset = unavailable. Notably NOT the portal-ready
 *    fallback's names and NOT OBSERVE_REPORT_TEMPLATE (whose default is the Swahili `observation_report_sw`).
 *  - HER ITEM ONLY. Ownership is the query (`user_id = her`), never the request body.
 *  - SELF-CONTAINED (bd-fmf24g.43). This file builds the message for all four kinds. It needs neither the ready-notice
 *    modules (portal-ready-*) nor the area-link signer, so lesson and paper sends work on a branch that has neither.
 *
 * THE TEMPLATES — infrastructure/templates/share/ (UTILITY, en + ur, no footer, no buttons):
 *   share_paper_v1               DOCUMENT header (the PDF) · {{1}} title {{2}} grade {{3}} subject {{4}} question count
 *   share_lesson_plan_v1         DOCUMENT header (the PDF) · {{1}} title {{2}} grade {{3}} subject
 *   share_dc_report_v1           IMAGE header (the report) · {{1}} topic {{2}} class line ("Grade 4 · Science")
 *   share_observation_report_v1  IMAGE header (the report) · {{1}} topic {{2}} class line
 * Meta rejects a variable with a newline, a tab or four spaces in a row, and an empty one: every variable is one line
 * and never empty. A missing title falls back to the app's own word for the item, in her language (ux-strings share*).
 */

const { logToFile } = require('../utils/logger');
const { logEvent } = require('../utils/structured-logger');
const { UX_STRINGS } = require('../config/ux-strings');
const { getLanguage } = require('../config/languages');

const KINDS = Object.freeze(['lesson', 'paper', 'dc', 'observation']);
const ENV_OF = Object.freeze({
  lesson: 'WHATSAPP_SHARE_TEMPLATE_LESSON',
  paper: 'WHATSAPP_SHARE_TEMPLATE_PAPER',
  dc: 'WHATSAPP_SHARE_TEMPLATE_DC',
  observation: 'WHATSAPP_SHARE_TEMPLATE_OBSERVATION',
});
/** Meta: 132001 template does not exist (in that language), 132015 paused, 132016 disabled. */
const TEMPLATE_GONE = Object.freeze([132001, 132015, 132016]);
/** The languages each share template is approved in, by these exact codes (not en_US). */
const LANGS = Object.freeze(['en', 'ur']);
const FSI = '⁨';
const PDI = '⁩';

function templateNameFromEnv(kind, env = process.env) {
  const key = ENV_OF[kind];
  const v = key && env ? String(env[key] || '').trim() : '';
  return v || null;
}

/** Which kinds this deployment can send at all (a template is named for them). The app greys the button for the rest. */
function availability(env = process.env) {
  return Object.fromEntries(KINDS.map((k) => [k, !!templateNameFromEnv(k, env)]));
}

const first = (embedded) => (Array.isArray(embedded) ? embedded[0] : embedded) || null;
const gradeOf = (code) => Number(String(code || '').replace(/^grade_/, '')) || null;

/** The textbook's name for a paper's chapter (textbook_toc via assessment-browse). Null when it has none or cannot say. */
async function chapterTitle(grade, subjectCode, chapter) {
  if (!grade || !subjectCode || chapter == null) return null;
  try {
    const { listChapters } = require('./assessment/assessment-browse.service');
    const hit = ((await listChapters(grade, subjectCode)) || []).find((c) => Number(c.chapter_number) === Number(chapter));
    return (hit && hit.chapter_title) || null;
  } catch (err) {
    logToFile('share send: chapter title lookup failed — naming the paper by its chapter number', { error: err && err.message }, 'warn');
    return null;
  }
}

/** The portal item for each kind, ONLY if it is hers. Null = not hers / not there. `{ unsupported }` = not covered. */
function itemResolvers(supabase, { presign } = {}) {
  const sign = presign || (async (urlOrKey) => {
    const { buildR2PublicUrl, getPresignedUrl } = require('../storage/r2');
    return getPresignedUrl(/^https?:/i.test(String(urlOrKey)) ? urlOrKey : buildR2PublicUrl(urlOrKey));
  });
  return {
    async paper(userId, id) {
      const { data, error } = await supabase.from('assessment_requests')
        .select('id, grade_code, subject_code, chapter_number, question_count, assessment_papers!inner(status, file_r2_key, question_count)')
        .eq('id', id).eq('user_id', userId).eq('assessment_papers.status', 'ready').limit(1).maybeSingle();
      if (error) throw new Error(error.message || 'paper read failed');
      const p = data && first(data.assessment_papers);
      if (!data || !p || !p.file_r2_key) return null;
      const grade = gradeOf(data.grade_code);
      const chapter = data.chapter_number ?? null;
      const { subjectLabel } = require('./assessment/assessment-vocabulary');
      return {
        kind: 'paper', itemRef: `paper:${data.id}`, title: await chapterTitle(grade, data.subject_code, chapter), chapter, grade,
        subject: data.subject_code ? subjectLabel(data.subject_code) : null,
        questions: p.question_count ?? data.question_count ?? null, pdfUrl: await sign(p.file_r2_key),
      };
    },
    async lesson(userId, id) {
      const m = /^g612:(.+)$/.exec(String(id));
      if (!m) return { unsupported: 'lesson_source' }; // grades 1-5 plans have no per-teacher record to scope a send by
      const { data, error } = await supabase.from('niete_lp612_deliveries')
        .select('render_id, segment_id, lang, niete_lp612_renders!inner(status, r2_key)')
        .eq('user_id', userId).eq('render_id', m[1]).eq('niete_lp612_renders.status', 'ready').limit(1);
      if (error) throw new Error(error.message || 'lesson read failed');
      const row = Array.isArray(data) ? data[0] : null;
      const render = row && first(row.niete_lp612_renders);
      if (!row || !render || !render.r2_key) return null;
      const meta = await supabase.from('niete_lp612_segments').select('segment_id, subtopic_title, menu_title, grade, subject')
        .eq('segment_id', row.segment_id).limit(1);
      if (meta && meta.error) throw new Error(meta.error.message || 'lesson segment read failed'); // failed, not a nameless plan
      const seg = (meta && Array.isArray(meta.data) && meta.data[0]) || {};
      return {
        kind: 'lesson', itemRef: `lesson:${row.segment_id}:${LANGS.includes(row.lang) ? row.lang : 'en'}`,
        title: seg.subtopic_title || seg.menu_title || null, grade: seg.grade == null ? null : Number(seg.grade), subject: seg.subject || null,
        pdfUrl: await sign(render.r2_key),
      };
    },
    async session(userId, id, wantObservation) {
      const { data, error } = await supabase.from('coaching_sessions')
        .select('id, observation_type, report_pdf_url, analysis_data')
        .eq('id', id).eq('user_id', userId).maybeSingle();
      if (error) throw new Error(error.message || 'session read failed');
      if (!data) return null;
      const isObs = data.observation_type === 'leader_observation';
      if (isObs !== wantObservation) return null;
      const ad = data.analysis_data || {};
      const delivery = ad.teacher_delivery || {};
      // A coach's observation is hers only once it has been sent to her (dashboard/lib/teacher-observation.js).
      if (isObs && !['sent', 'awaiting_teacher_tap'].includes(delivery.status)) return null;
      const source = data.report_pdf_url || (delivery.report_key ? delivery.report_key : null);
      if (!source) return null;
      return {
        kind: wantObservation ? 'observation' : 'dc', itemRef: `report:${data.id}`,
        title: ad.topic || null, grade: ad.grade || null, subject: ad.subject || null,
        imageUrl: await sign(source),
      };
    },
    dc(userId, id) { return this.session(userId, id, false); },
    observation(userId, id) { return this.session(userId, id, true); },
  };
}

/** One line, single-spaced (Meta rejects a newline, a tab or four spaces in a variable), at most `max` code points. */
function oneLine(text, max = 60) {
  const t = String(text == null ? '' : text).replace(/[\s‎‏⁦-⁩]+/g, ' ').trim();
  const cps = [...t];
  return cps.length <= max ? t : `${cps.slice(0, max - 1).join('').trimEnd()}…`;
}

/** A catalog word for this language, its {placeholders} filled. Raw: a template variable carries no direction mark. */
function word(key, lang, params = {}) {
  const v = UX_STRINGS[key];
  return (v[lang] ?? v.en).replace(/\{(\w+)\}/g, (_, k) => String(params[k] ?? ''));
}

/** Latin letters, digits and a little punctuation only: the document's file name is the same in every language. */
function latin(text) {
  return String(text == null ? '' : text).replace(/[^A-Za-z0-9 .,&'()_-]/g, ' ').replace(/\s+/g, ' ').trim();
}

/** "Paper - Grade 4 Science - Plants and food.pdf" — what she sees on the document in her chat and her downloads. */
function fileName(item) {
  const label = item.kind === 'paper' ? 'Paper' : 'Lesson plan';
  const klass = [item.grade ? `Grade ${item.grade}` : '', latin(item.subject)].filter(Boolean).join(' ');
  return `${[label, klass, latin(item.title).slice(0, 60).trim()].filter(Boolean).join(' - ')}.pdf`;
}

/** The title variable ({{1}}): the item's own name, else the app's word for it. Never empty, never "-". */
function titleOf(item, lang) {
  const own = oneLine(item.title);
  if (own) return own;
  const subject = oneLine(item.subject, 40);
  if (item.kind === 'paper') {
    if (item.chapter != null) return word('shareChapter', lang, { n: item.chapter });
    return subject ? word('shareSubjectPaper', lang, { subject }) : word('sharePaper', lang);
  }
  if (item.kind === 'lesson') return word('shareLessonPlan', lang);
  return word(item.kind === 'observation' ? 'shareObservation' : 'shareDcObservation', lang);
}

/**
 * The subject variable ({{3}}). In a right-to-left line (Urdu) a Latin subject is isolated: "جماعت 4 · Science · 15 سوال" otherwise
 * lays out with the count beside the subject instead of beside سوال (language-protocol §8: isolate every Latin atom).
 */
function subjectOf(item, lang) {
  const s = oneLine(item.subject, 40);
  // Unreachable: subject_code and niete_lp612_segments.subject are NOT NULL (as are grade and question_count, below).
  // The guard only keeps a variable from ever being empty, which Meta rejects.
  if (!s) return '-';
  const rtl = (getLanguage(lang) || {}).direction === 'rtl';
  return rtl ? `${FSI}${s}${PDI}` : s;
}

/** The class line of a report ({{2}}): "Grade 4 · Science" / "جماعت 4 · Science", else "Your" / "آپ" (→ "Your class"). */
function classLineOf(item, lang) {
  const parts = [item.grade ? word('shareGrade', lang, { grade: item.grade }) : null, oneLine(item.subject, 30) || null].filter(Boolean);
  return parts.length ? oneLine(parts.join(' · '), 40) : word('shareClassFallback', lang);
}

/** The template's parameters for one item, in her language. */
function componentsFor(item, { lang = 'en' } = {}) {
  const text = (t) => ({ type: 'text', text: t });
  if (item.kind === 'paper' || item.kind === 'lesson') {
    const body = [titleOf(item, lang), item.grade ? String(item.grade) : '-', subjectOf(item, lang)];
    if (item.kind === 'paper') body.push(item.questions != null ? String(item.questions) : '-');
    return [
      { type: 'header', parameters: [{ type: 'document', document: { link: item.pdfUrl, filename: fileName(item) } }] },
      { type: 'body', parameters: body.map(text) },
    ];
  }
  return [
    { type: 'header', parameters: [{ type: 'image', image: { link: item.imageUrl } }] },
    { type: 'body', parameters: [text(titleOf(item, lang)), text(classLineOf(item, lang))] },
  ];
}

function defaultDeps() {
  const supabase = require('../config/supabase');
  const WhatsAppService = require('./whatsapp.service');
  const resolvers = itemResolvers(supabase);
  return {
    templateName: (kind) => templateNameFromEnv(kind),
    async user(userId) {
      const { data, error } = await supabase.from('users').select('id, phone_number, preferred_language').eq('id', userId).maybeSingle();
      if (error) throw new Error(error.message || 'user read failed');
      return data || null;
    },
    item: (kind, id, userId) => resolvers[kind](userId, id),
    now: () => new Date(),
    sendTemplate: (...a) => WhatsAppService.sendTemplate(...a),
  };
}

/**
 * @param {{ userId: string, kind: string, id: string }} req
 * @returns {Promise<{status:'sent', at:string}|{status:'failed'|'unavailable', reason:string}|{status:'not_found'|'bad_request'}>}
 */
async function sendShare({ userId, kind, id } = {}, deps) {
  if (!userId || !KINDS.includes(kind) || !id || typeof id !== 'string') return { status: 'bad_request' };
  const d = deps || defaultDeps();
  try {
    const name = d.templateName(kind);
    if (!name) return { status: 'unavailable', reason: 'not_configured' };

    const user = await d.user(userId);
    if (!user || !user.phone_number) return { status: 'unavailable', reason: 'no_phone' };
    const item = await d.item(kind, id, userId);
    if (!item) return { status: 'not_found' };
    if (item.unsupported) return { status: 'unavailable', reason: item.unsupported };

    const lang = LANGS.includes(user.preferred_language) ? user.preferred_language : 'en';
    const components = componentsFor(item, { lang });
    const report = {};
    const ok = (await d.sendTemplate(user.phone_number, name, lang, components, { report })) === true;
    try { logEvent(ok ? 'share_send.sent' : 'share_send.refused', { kind, userId, template: name, lang, code: report.code || null }); } catch (_) { /* logging never decides */ }
    if (ok) return { status: 'sent', at: d.now().toISOString() };
    if (TEMPLATE_GONE.includes(Number(report.code))) return { status: 'unavailable', reason: 'template_missing' };
    return { status: 'failed', reason: 'refused' };
  } catch (err) {
    logToFile('❌ share send failed', { kind, userId, error: err && err.message }, 'error');
    return { status: 'failed', reason: 'error' };
  }
}

module.exports = { sendShare, availability, itemResolvers, componentsFor, templateNameFromEnv, KINDS, ENV_OF, TEMPLATE_GONE };
