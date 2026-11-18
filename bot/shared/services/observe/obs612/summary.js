'use strict';

/**
 * bd-pni007 — the coach's summary of an FDE (obs612) visit, sent in chat the moment the form is saved.
 *
 * Built from the coach's own answers and writing only (no model call, nothing scored by a model):
 *
 *   ✅ Saved. <teacher> · Grade N · <Subject>
 *   <tool>: <FDE's result>        enur 109 / 148 · 73.6% · Proficient | gen Yes on 29 of 35 | msci levels, no total
 *   Strongest / Lowest            sections (enur, gen) or indicators (msci), from the coach's answers
 *   For the talk with the teacher Section 8 (enur), the feedback line (gen), the development plan (msci)
 *   _FDE v1_                      the label (operator 11 Nov: framework + version only)
 *
 * The buttons are the EXISTING send-report ids (observe-send.service BTN): observe_send_start_<sid> runs
 * ObserveSend.startSendFlow (the preview → confirm → send-to-teacher path), observe_send_later_<sid> runs
 * handleSendLater. Both are routed in whatsapp-bot.js already; this module adds no route.
 *
 * Language: the coach's (en | ur, clamped to the offer). FDE's own wording (section titles, band names, item text)
 * stays English as FDE printed it; in Urdu lines it is isolated (LRI … PDI) so the line keeps its order, and coach-
 * written text is first-strong isolated (FSI … PDI) in both languages. Urdu is a DRAFT for native review: imperatives
 * and impersonal forms only (coaches are women and men), Urdu digits in Urdu prose.
 */

const O = require('../../coaching/frameworks/obs612');
const { obs612View, num } = require('./view');
const { SUBJECT_LABELS, urDigits } = require('./strings');
const { clampLanguage } = require('../../../config/ux-strings');
// An interactive body's cap in code points (Meta refuses the whole message over it). Kept here rather than in a shared
// helper: this module rides to staging and main on its own, and must not depend on one only sandbox has.
const BODY_CAP = 1024;
/** The parts joined by a blank line when the result fits `cap` code points, else null (send them apart). */
function joinWithinCap(parts, cap) {
  const kept = (parts || []).map((p) => (p == null ? '' : String(p).trim())).filter(Boolean);
  if (!kept.length) return null;
  const joined = kept.join('\n\n');
  return [...joined].length <= cap ? joined : null;
}
const { logToFile } = require('../../../utils/logger');

const LRI = '⁦';
const FSI = '⁨';
const PDI = '⁩';
const ltr = (s) => `${LRI}${s}${PDI}`;
// A coach's own words, first-strong isolated; a held-down-key run broken up so it cannot read as broken script.
const own = (s) => `${FSI}${require('./view').readableNote(s)}${PDI}`;
const asIs = (s) => String(s);

// Coach-written text is quoted, never rewritten; a very long note is cut so the summary stays one readable message.
const NOTE_MAX = 280;
const clip = (s) => {
  const cps = [...String(s || '').trim()];
  return cps.length <= NOTE_MAX ? cps.join('') : `${cps.slice(0, NOTE_MAX - 1).join('')}…`;
};

const STRINGS = {
  en: {
    d: asIs,
    fde: asIs,
    sep: ', ',
    saved: '✅ Saved.',
    grade: (g) => `Grade ${g}`,
    tools: { msci: 'Maths & Science tool', enur: 'English & Urdu tool', gen: 'General form' },
    enur: (v) => `${v.total} / ${v.max} · ${num(v.score_108)} / 108 · ${v.band}`,
    gen: (v) => `Yes on ${v.yes} of ${v.of}`,
    msci: (n) => `${n} indicators, Level 0-3. FDE gives no total.`,
    levels: 'Levels',
    atLevel: (count, level) => `${count} at Level ${level}`,
    level: (l) => `Level ${l}`,
    scoreOf: (s) => `${s.score}/${s.max}`,
    yesOf: (s) => `${s.yes} of ${s.of}`,
    strongest: 'Strongest',
    lowest: 'Lowest',
    highest: 'Highest',
    even: 'Every section at the same level.',
    students: (i) => `5 students checked: ${O.STUDENTS_SHORT[i]}`,
    talk: 'For the talk with the teacher',
    start: 'Start with',
    workOn: 'Work on',
    agree: 'Agree on',
    by: 'By',
    feedback: 'Your feedback',
    lookAt: 'Look at together',
    plan: 'Development plan',
    note: 'Your note',
    ask: (name) => (name
      ? `Send ${name} the FDE report? You'll see it first.`
      : "Send the teacher the FDE report? You'll see it first."),
  },
  ur: {
    d: urDigits,
    fde: ltr,
    sep: '، ',
    saved: '✅ محفوظ ہو گیا۔',
    grade: (g) => `جماعت ${urDigits(g)}`,
    tools: { msci: 'ریاضی اور سائنس ٹول', enur: 'انگریزی اور اردو ٹول', gen: 'عمومی فارم' },
    enur: (v) => `${urDigits(v.total)} / ${urDigits(v.max)} · ${urDigits(num(v.score_108))} / ${urDigits(108)} · ${ltr(v.band)}`,
    gen: (v) => `${urDigits(v.of)} میں سے ${urDigits(v.yes)} پر ہاں`,
    msci: (n) => `${urDigits(n)} نکات، لیول ۰ تا ۳۔ ایف ڈی ای اس ٹول کا کوئی مجموعی اسکور نہیں دیتا۔`,
    levels: 'لیول',
    atLevel: (count, level) => `لیول ${urDigits(level)} پر ${urDigits(count)}`,
    level: (l) => `لیول ${urDigits(l)}`,
    scoreOf: (s) => `${urDigits(s.score)}/${urDigits(s.max)}`,
    yesOf: (s) => `${urDigits(s.of)} میں سے ${urDigits(s.yes)}`,
    strongest: 'سب سے مضبوط',
    lowest: 'سب سے کم',
    highest: 'سب سے بلند',
    even: 'تمام حصے ایک ہی سطح پر ہیں۔',
    students: (i) => `۵ طلبہ کی جانچ: ${['۵ میں سے ۰ تا ۱ نے سمجھا', '۵ میں سے ۲ نے سمجھا', '۵ میں سے ۳ تا ۴ نے سمجھا', '۵ میں سے سب نے سمجھا'][i]}`,
    talk: 'استاد سے گفتگو کے لیے',
    start: 'آغاز',
    workOn: 'بہتری کا پہلو',
    agree: 'طے کریں',
    by: 'مدت',
    feedback: 'آپ کی رائے',
    lookAt: 'مل کر دیکھیں',
    plan: 'ترقیاتی منصوبہ',
    note: 'آپ کا نوٹ',
    ask: (name) => (name
      ? `${own(name)} کو ایف ڈی ای رپورٹ بھیجیں؟ بھیجنے سے پہلے رپورٹ آپ کو دکھائی جائے گی۔`
      : 'استاد کو ایف ڈی ای رپورٹ بھیجیں؟ بھیجنے سے پہلے رپورٹ آپ کو دکھائی جائے گی۔'),
  },
};

function stringsFor(lang) {
  return { lang: clampLanguage(lang), ...STRINGS[clampLanguage(lang)] };
}

const bullet = (label, text) => `• ${label}: ${text}`;

function savedLine(v, L, teacherName) {
  const subject = v.subject && SUBJECT_LABELS[L.lang] && SUBJECT_LABELS[L.lang][v.subject];
  const name = String(teacherName || '').trim();
  const who = [
    name ? (L.lang === 'en' ? name : own(name)) : null,
    v.grade ? L.grade(v.grade) : null,
    subject || v.subjectLabel,
  ].filter(Boolean).join(' · ');
  return who ? `${L.saved} ${who}` : L.saved;
}

const sectionList = (rows, L, value) => rows.map((s) => `${L.fde(s.title)} (${value(s)})`).join(L.sep);
const indicatorName = (i, L) => L.fde(`${i.n} ${i.short}`);

function resultLines(v, L) {
  const tool = L.tools[v.tool];
  if (v.tool === 'enur') {
    const lines = [`${tool}: ${L.enur(v.enur)}`];
    if (v.even) lines.push(L.even);
    if (v.strongest.length && !v.even) lines.push(`${L.strongest}: ${sectionList(v.strongest, L, L.scoreOf)}`);
    if (v.lowest.length) lines.push(`${L.lowest}: ${sectionList(v.lowest, L, L.scoreOf)}`);
    return lines;
  }
  if (v.tool === 'gen') {
    const lines = [`${tool}: ${L.gen(v.gen)}`];
    if (v.even) lines.push(L.even);
    if (v.strongest.length && !v.even) lines.push(`${L.strongest}: ${sectionList(v.strongest, L, L.yesOf)}`);
    if (v.lowest.length) lines.push(`${L.lowest}: ${sectionList(v.lowest, L, L.yesOf)}`);
    return lines;
  }
  const m = v.msci;
  const lines = [`${tool}: ${L.msci(m.indicators.length)}`];
  const levels = [3, 2, 1, 0].filter((l) => m.counts[l]).map((l) => L.atLevel(m.counts[l], l));
  if (levels.length) lines.push(`${L.levels}: ${levels.join(' · ')}`);
  if (v.strongest.length && !v.even) {
    lines.push(`${L.highest}: ${v.strongest.map((i) => indicatorName(i, L)).join(L.sep)} (${L.level(v.strongest[0].level)})`);
  }
  if (v.lowest.length) {
    lines.push(`${L.lowest}: ${v.lowest.map((i) => indicatorName(i, L)).join(L.sep)} (${L.level(v.lowest[0].level)})`);
  }
  if (m.students.level !== null) lines.push(L.students(m.students.level));
  return lines;
}

/** "Level 0 → Level 1" — an English atom, so it keeps its arrow and order in an Urdu line too. */
function planMove(p) {
  const parts = [];
  if (p.current !== null) parts.push(`Level ${p.current}`);
  if (p.goal !== null) parts.push(`Level ${p.goal}`);
  return parts.join(' → ');
}

function talkLines(v, L) {
  const lines = [];
  if (v.tool === 'enur') {
    const f = v.feedback;
    if (f.strengths) lines.push(bullet(L.start, own(clip(f.strengths))));
    if (f.areas) lines.push(bullet(L.workOn, own(clip(f.areas))));
    if (f.recommendations) lines.push(bullet(L.agree, own(clip(f.recommendations))));
    if (f.timeline) lines.push(bullet(L.by, own(clip(f.timeline))));
  } else if (v.tool === 'gen') {
    if (v.strongest.length) lines.push(bullet(L.start, v.strongest.map((s) => L.fde(s.title)).join(L.sep)));
    if (v.feedback.line) lines.push(bullet(L.feedback, own(clip(v.feedback.line))));
    const no = v.lowest.flatMap((s) => s.noItems).slice(0, 3);
    if (no.length) lines.push(bullet(L.lookAt, no.map((t) => L.fde(String(t).replace(/[.\s]+$/, ''))).join('; ')));
  } else {
    if (v.strongest.length && !v.even) lines.push(bullet(L.start, v.strongest.map((i) => indicatorName(i, L)).join(L.sep)));
    for (const p of v.plan) {
      const move = planMove(p);
      const head = [L.fde(p.short), move ? L.fde(move) : null].filter(Boolean).join(': ');
      lines.push(bullet(L.plan, `${head}${p.action ? `. ${own(clip(p.action))}` : ''}`));
      const ind = v.msci.indicators.find((i) => i.key === p.area);
      if (ind && ind.observation) lines.push(bullet(L.note, own(clip(ind.observation))));
    }
  }
  return lines;
}

/**
 * The "For the talk with the teacher" block alone (heading + lines), or null when the coach wrote nothing to build it
 * from. The debrief entry uses it as an FDE visit's guide (observe-debrief buildDebriefGuide), so the FICO guide never
 * runs on an FDE row.
 */
function buildTalkGuide(analysis, { lang } = {}) {
  const v = obs612View(analysis);
  if (!v) return null;
  const L = stringsFor(lang);
  const lines = talkLines(v, L);
  return lines.length ? [`*${L.talk}*`, ...lines].join('\n') : null;
}

/**
 * The coach's summary of an FDE visit, as one chat text. Pure. Null when the analysis is not an FDE visit.
 * @param {object} analysis  coaching_sessions.analysis_data of the visit (record.js buildAnalysis shape)
 * @param {{lang?: string, teacherName?: string}} [opts]
 */
function buildCoachSummary(analysis, { lang, teacherName } = {}) {
  const v = obs612View(analysis);
  if (!v) return null;
  const L = stringsFor(lang);
  const blocks = [
    [savedLine(v, L, teacherName), ...resultLines(v, L)].join('\n'),
    buildTalkGuide(analysis, { lang: L.lang }),
    `_${v.label}_`,
  ];
  return blocks.filter(Boolean).join('\n\n');
}

/**
 * The buttons message: the summary and the question in one body when they fit WhatsApp's 1,024 code points; else
 * `lead` is the summary as its own text and the buttons carry the question alone.
 */
function buildSummaryMessages(sessionId, analysis, { lang, teacherName } = {}) {
  const summary = buildCoachSummary(analysis, { lang, teacherName });
  if (!summary) return null;
  const L = stringsFor(lang);
  const { observeStrings } = require('../observe-strings');
  const { buildSendChoiceButtons } = require('../observe-send.service');
  // The send flow's own ids and titles (observe_send_start_ / observe_send_later_): a tap lands in startSendFlow.
  const choice = buildSendChoiceButtons(sessionId, observeStrings(L.lang));
  const ask = L.ask(String(teacherName || '').trim());
  const merged = joinWithinCap([summary, ask], BODY_CAP);
  return {
    summary,
    lead: merged ? null : summary,
    buttons: { ...choice, body: merged || ask },
  };
}

async function readPeople(supabase, { coachUserId, sessionId, analysis }) {
  let teacherId = (analysis.obs612 && analysis.obs612.teacher_user_id) || null;
  if (!teacherId && sessionId) {
    // No teacher on the form: the session's user_id is the teacher only when it is bound to someone else.
    const { data: row } = await supabase
      .from('coaching_sessions').select('user_id, observer_user_id').eq('id', sessionId).maybeSingle();
    if (row && row.user_id && row.user_id !== (row.observer_user_id || coachUserId)) teacherId = row.user_id;
  }
  const ids = [coachUserId, teacherId].filter(Boolean);
  const { data, error } = await supabase
    .from('users').select('id, name, phone_number, preferred_language').in('id', ids);
  if (error) throw new Error(`users read failed: ${error.message}`);
  const rows = Array.isArray(data) ? data : [];
  const coach = rows.find((u) => u.id === coachUserId) || null;
  const teacher = teacherId && teacherId !== coachUserId ? rows.find((u) => u.id === teacherId) || null : null;
  return { coach, teacherName: teacher && teacher.name ? String(teacher.name).trim() : '' };
}

/**
 * Send the coach the summary with the send-report buttons. Never throws; every failure is logged.
 * @param {{coachUserId: string, sessionId: string, analysis: object}} args
 * @returns {Promise<{sent: boolean, reason?: string}>}
 */
async function sendCoachSummary({ coachUserId, sessionId, analysis } = {}) {
  try {
    if (!obs612View(analysis)) {
      logToFile('⚠️ obs612 summary: not an FDE analysis — nothing sent', { sessionId }, 'warn');
      return { sent: false, reason: 'not_obs612' };
    }
    const supabase = require('../../../config/supabase');
    const WhatsAppService = require('../../whatsapp.service');
    const { observeLang } = require('../observe-strings');
    const { coach, teacherName } = await readPeople(supabase, { coachUserId, sessionId, analysis });
    if (!coach || !coach.phone_number) {
      logToFile('❌ obs612 summary: the coach has no phone on file — summary not sent', { sessionId, coachUserId }, 'error');
      return { sent: false, reason: 'no_coach_phone' };
    }
    const to = coach.phone_number;
    const msg = buildSummaryMessages(sessionId, analysis, { lang: observeLang(coach), teacherName });

    if (msg.lead) {
      const ok = await WhatsAppService.sendMessage(to, msg.lead);
      if (ok === false) logToFile('❌ obs612 summary: the summary text was refused', { sessionId }, 'error');
    }
    const shown = await WhatsAppService.sendInteractiveButtons(to, msg.buttons);
    if (shown === false) {
      logToFile('❌ obs612 summary: the send-report buttons were refused — the summary goes as text', { sessionId }, 'error');
      // The coach is never left with nothing: the summary as text (the /observe list keeps the way back in).
      if (!msg.lead) {
        const ok = await WhatsAppService.sendMessage(to, msg.summary);
        if (ok === false) {
          logToFile('❌ obs612 summary: the text fallback was refused too', { sessionId }, 'error');
          return { sent: false, reason: 'refused' };
        }
      }
      return { sent: true, buttons: false };
    }
    logToFile('📋 obs612 summary sent to the coach', { sessionId, coachUserId, tool: analysis.obs612.tool });
    return { sent: true, buttons: true };
  } catch (err) {
    logToFile('❌ obs612 summary: failed', { sessionId, coachUserId, error: err && err.message }, 'error');
    return { sent: false, reason: 'error' };
  }
}

module.exports = { buildCoachSummary, buildTalkGuide, buildSummaryMessages, sendCoachSummary, STRINGS };
