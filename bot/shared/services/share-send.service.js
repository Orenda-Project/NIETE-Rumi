'use strict';
/**
 * bd-fmf24g.30 — "Send on WhatsApp" from a portal screen (the ShareActions kit button). ONE entry, `sendShare`,
 * behind POST /api/internal/share/send (routes/internal-share.routes.js) ← POST /api/portal/share/whatsapp.
 *
 * RULES
 *  - TEMPLATE ONLY. Meta prices every message and there is no free window, so a free-form send buys nothing and fails
 *    outside the 24 h window. The template's URL button brings her back into the app.
 *  - THE REAL RESULT. `sent` only when Meta accepted it; `failed` when it refused (retry may work); `unavailable` when
 *    this deployment has no template for the kind, Meta says the template is missing/paused/disabled, or the item is of a
 *    kind this send does not cover. Never a "sent" that did not happen (cf. bd-fmf24g.36).
 *  - NO DEFAULT TEMPLATE NAMES. The name comes from env, per deployment (templates are per WABA, and each env has its own
 *    approval). `WHATSAPP_SHARE_TEMPLATE_{LESSON,PAPER,DC,OBSERVATION}`; unset = unavailable. Notably NOT the portal-ready
 *    fallback's names and NOT OBSERVE_REPORT_TEMPLATE (whose default is the Swahili `observation_report_sw`).
 *  - HER ITEM ONLY. Ownership is the query (`user_id = her`), never the request body.
 *
 * Nothing here is switched on today: no template is configured on any environment (drafts: infrastructure/templates/drafts/).
 * Report templates (dc, observation) are not drafted yet: their shape below (image header; body {{1}} title, {{2}} class
 * line) is the proposal the draft will follow.
 */

const { logToFile } = require('../utils/logger');
const { logEvent } = require('../utils/structured-logger');

const KINDS = Object.freeze(['lesson', 'paper', 'dc', 'observation']);
const ENV_OF = Object.freeze({
  lesson: 'WHATSAPP_SHARE_TEMPLATE_LESSON',
  paper: 'WHATSAPP_SHARE_TEMPLATE_PAPER',
  dc: 'WHATSAPP_SHARE_TEMPLATE_DC',
  observation: 'WHATSAPP_SHARE_TEMPLATE_OBSERVATION',
});
/** Meta: 132001 template does not exist (in that language), 132015 paused, 132016 disabled. */
const TEMPLATE_GONE = Object.freeze([132001, 132015, 132016]);
const LANGS = Object.freeze(['en', 'ur']);

function templateNameFromEnv(kind, env = process.env) {
  const key = ENV_OF[kind];
  const v = key && env ? String(env[key] || '').trim() : '';
  return v || null;
}

const first = (embedded) => (Array.isArray(embedded) ? embedded[0] : embedded) || null;
const gradeOf = (code) => Number(String(code || '').replace(/^grade_/, '')) || null;

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
      const Ready = require('./portal-ready-whatsapp.service');
      const grade = gradeOf(data.grade_code);
      const title = await Ready.paperTitle({ grade, subjectKey: data.subject_code, chapterNumber: data.chapter_number });
      const { subjectLabel } = require('./assessment/assessment-vocabulary');
      return {
        kind: 'paper', itemRef: `paper:${data.id}`, title, grade, subject: subjectLabel(data.subject_code),
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
        title: ad.topic || null, line: [ad.grade ? `Grade ${ad.grade}` : null, ad.subject || null].filter(Boolean).join(' · ') || null,
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

function componentsFor(item, { token, lang }) {
  if (item.kind === 'paper' || item.kind === 'lesson') {
    const { buildSend } = require('./portal-ready-templates');
    return buildSend({
      kind: item.kind, lang, token, pdfUrl: item.pdfUrl, title: item.title, grade: item.grade, subject: item.subject, questions: item.questions,
    }).components;
  }
  return [
    { type: 'header', parameters: [{ type: 'image', image: { link: item.imageUrl } }] },
    { type: 'body', parameters: [{ type: 'text', text: oneLine(item.title) || '-' }, { type: 'text', text: oneLine(item.line, 40) || '-' }] },
  ];
}

function defaultDeps() {
  const supabase = require('../config/supabase');
  const WhatsAppService = require('./whatsapp.service');
  const { signPortalLink } = require('./portal-link-token');
  const resolvers = itemResolvers(supabase);
  return {
    templateName: (kind) => templateNameFromEnv(kind),
    async user(userId) {
      const { data, error } = await supabase.from('users').select('id, phone_number, preferred_language').eq('id', userId).maybeSingle();
      if (error) throw new Error(error.message || 'user read failed');
      return data || null;
    },
    item: (kind, id, userId) => resolvers[kind](userId, id),
    token: (userId, itemRef) => (/^(paper|lesson):/.test(itemRef) ? signPortalLink(userId, 'ready', { i: itemRef }) : null),
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
    const token = d.token(userId, item.itemRef);
    if ((kind === 'paper' || kind === 'lesson') && !token) {
      logToFile('share send: no portal-link signing secret on this deployment', { kind, userId }, 'warn');
      return { status: 'unavailable', reason: 'no_signing_secret' };
    }
    const components = componentsFor(item, { token, lang });
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

module.exports = { sendShare, itemResolvers, templateNameFromEnv, KINDS, ENV_OF, TEMPLATE_GONE };
