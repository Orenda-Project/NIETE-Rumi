'use strict';

/**
 * /observe2 — the moments in the recording, and when the coach gets to check them.
 *
 * After an /observe2 recording is transcribed (its session is linked to a field form), one model
 * call reads the timestamped transcript and returns the moments that matter for the heard
 * indicators, grouped the way the coach checks them (asking, wrong answers, working, explaining),
 * each with its minute and the words said, plus two counts that only separate levels 1 and 2.
 * The levels those moments add up to on their own are stored beside them and never shown: they
 * are the recording's half of the comparison with the coach's sealed record.
 *
 * The check opens when the record is sealed AND the moments are in, whichever comes last (this
 * module after the moments; the form endpoint after the seal).
 *
 * coaching_sessions.status moves through statuses of its own, so no /observe sweeper, list or
 * watchdog acts on the row:
 *   observe2_moments        reading the recording
 *   observe2_ready          moments stored, waiting for the seal
 *   observe2_checking       the check was sent
 *   (then)                  the check hands the visit to /observe's debrief: observer_review_complete
 *   observe2_no_timestamps  the transcript has no [MM:SS] timings, so no moment can be placed
 *   observe2_failed         the model call or the write failed, or the reply was cut off at the output
 *                           limit twice (logged at error)
 */

const supabase = require('../../../config/supabase');
const WhatsAppService = require('../../whatsapp.service');
const Store = require('./field-form.store');
const { heardLevels } = require('./rules');
const { checkQuotes } = require('./quote-check');
const { observe2Strings } = require('./strings');
const { clampLanguage } = require('../../../config/ux-strings');
const { getLanguage } = require('../../../config/languages');
const { logToFile } = require('../../../utils/logger');

// v2 (bd-eal7zn.3): evidence first, what is never a moment, question — answer quotes, no stretched types,
// and a "why" per moment. v1 filled a 25-type menu "of different types where possible".
const PROMPT_VERSION = 'observe2-moments-v2';
const SLOTS = 8;
const QUOTE_MAX = 280;
const WHY_MAX = 120;
const TIMED_RX = /\[\d{1,3}:\d{2}\]/;

// Type → the short label the check shows after the minute ("12:41 · open question"); each fits the
// 30-code-point radio label with the minute in front.
const TYPES = {
  ask: {
    open_q_one: 'open question', open_q_choral: 'answered in chorus', probe: "'why' follow-up",
    reasoning: 'child explained why', long_answer: 'longer answer', beyond: 'went beyond the ask',
    content_q: "child's own question", proc_q: "'which page' question", beyond_q: 'question beyond lesson',
  },
  wrong: {
    wrong_reason: 'reason for the error', wrong_fixed: 'child fixed it', wrong_ignored: 'wrong answer left',
    strategy: 'tried a new way', praise_effort: 'praise for effort', praise_generic: "'well done' only",
    mistake_useful: 'mistake put to use', disagree: 'disagreement welcomed', hedged: 'tried while unsure',
    unprompted: 'tried without asking',
  },
  work: { choice: 'a real choice', handover: 'children led a part' },
  explain: {
    content_error: 'content error', term_defined: 'word explained', why_explained: 'why it works',
    life_link: 'link to real life',
  },
};
const GROUPS = Object.keys(TYPES);
const GROUP_OF = Object.fromEntries(GROUPS.flatMap((g) => Object.keys(TYPES[g]).map((t) => [t, g])));

const seconds = (mmss) => { const [m, s] = String(mmss).split(':').map(Number); return m * 60 + s; };
const clip = (text, max) => { const cps = [...text]; return cps.length > max ? `${cps.slice(0, max - 1).join('')}…` : text; };
const whole = (v) => { const n = Number(v); return Number.isInteger(n) && n >= 0 ? n : 0; };

// The lesson the coach picked the plan of, when there is one: moments about what it teaches come first.
function lessonLine(form) {
  const ref = (form && form.answers && form.answers.lp_ref) || null;
  const label = ref && String(ref.label || '').trim();
  return label
    ? `THE LESSON: ${label}`
    : 'THE LESSON: not given. Work out from the first minutes what the lesson is teaching (its aim, its new words, its skill).';
}

// "why" is written in the coach's language (users.preferred_language, clamped to NIETE's offer).
function whyRules(lang) {
  const L = getLanguage(clampLanguage(lang));
  const rules = [
    `For each moment, "why": one short sentence, at most 15 words, written in ${L.languageDescription}, saying what the`,
    'moment shows about the teaching or about the children\'s learning in this lesson, so the coach can use it',
    'in the conversation with the teacher. Plain words: no codes, no levels, no scores. Say "the teacher", "the',
    'child" or "the children"; never "he" or "she". For example: "The child gives a reason in their own words, so',
    'they understood why plants need light."',
  ];
  if (L.direction === 'rtl') {
    rules.push(
      `Write "why" in ${L.languageDescription} script (${L.script}), never in Roman letters; keep the JSON keys and the`,
      'type names in English. Write so that no verb shows whether the teacher or a child is a man or a woman',
      '(for example «استاد نے وجہ پوچھی», «بچوں نے اپنی مثال دی»).',
    );
  }
  return rules;
}

function buildPrompt(transcript, form, { lang } = {}) {
  const period = Number(form && form.period_minutes) || 40;
  const half = Math.round(period / 2);
  const list = (g) => Object.keys(TYPES[g]).join(', ');
  return [
    'You are helping a coach who sat in one classroom lesson. Read its transcript and pick the few MOMENTS that are',
    'real evidence about the teaching and the children\'s learning. The coach confirms each one and uses it to talk',
    'with the teacher afterwards, and what the coach confirms counts toward the lesson\'s levels.',
    '',
    lessonLine(form),
    'Each line reads "[MM:SS] Speaker (LANG): words": the minute the line starts, who spoke (Teacher, or Student,',
    'which may be several children), the language, and the words (often Urdu, sometimes English).',
    '',
    'WHAT A MOMENT IS',
    'Something said that shows how the teacher teaches or how the children think, about what this lesson teaches:',
    'the teacher\'s questions and the children\'s answers; a child\'s reason, idea, example or question; what happens',
    'after a wrong answer; how the teacher explains, defines or links the content; a real choice or real lead given',
    'to the children. It must be clear from the words alone: if it needs explaining, it is not a moment.',
    '',
    'NEVER A MOMENT (skip these even when a type below seems to fit):',
    '- names, roll-call, greetings; "sit down", "be quiet", "stand up"; "open page 83", "take out your copies",',
    '  books, homework and other admin;',
    '- discipline, threats and rewards ("no football tomorrow"), unless a child is shamed or mocked for an',
    '  answer: that is evidence, under WRONG ANSWERS;',
    '- a child asking to answer or to go ("shall I tell?", "my turn", "I have done it");',
    '- "understood?", "right?", "OK?" and other checks the class answers with "yes";',
    '- the class repeating, chanting, spelling, counting or reading aloud together;',
    '- a single word or letter on its own: a one-word answer counts only together with the question it answers;',
    '- a passage where the transcript does not make sense (garbled words, a sentence that does not fit the lesson):',
    '  the recording was not heard clearly there, so skip it.',
    '',
    'THE QUOTE',
    '- Copy the words exactly as the transcript writes them, in their own language. Never translate, fix or paraphrase.',
    '- A question and its answer: quote the question, then " — ", then the answer (two lines that follow each other).',
    '- Otherwise quote one line, cut to the whole sentence that shows the moment, never a fragment.',
    '- Keep each part short: the one or two sentences that show the moment, never a whole long turn.',
    '- A type that a child does (reasoning, long_answer, beyond, content_q, proc_q, beyond_q, wrong_fixed, hedged,',
    '  unprompted) quotes the child\'s own words; a type the teacher does quotes the teacher.',
    '- "minute" is the [MM:SS] of the line the quote starts in.',
    '',
    'WHY',
    ...whyRules(lang),
    '',
    'TYPES. Use a type only when the words clearly show exactly that. Most lessons have none of several types:',
    'return none rather than stretch a type to fit.',
    '',
    'ASKING — the teacher\'s questions, the children\'s answers and questions:',
    '- open_q_one: the teacher asks a question with more than one good answer (why, how, what do you think, give an',
    '  example, make a sentence) and one child answers. "What is a noun?", "how many?", "which is bigger?", "what did',
    '  we read yesterday?" have one right answer: they are NOT open.',
    '  TEST: could two children give two different answers that are both right? If not, it is closed:',
    '  do not pick it as a moment; count it in closed_q. Most questions in these lessons are closed.',
    '- open_q_choral: the same kind of open question, answered by the class together',
    '- probe: right after a child\'s answer, the teacher asks that child (or the class) why or how ("why do you think',
    '  so?", "how did you find it?"). A new question, a question the teacher answers, or "understood?" is NOT a probe.',
    '- reasoning: a child gives a reason ("because ...") in their own words',
    '- long_answer: a child answers in a full sentence of their own, without a reason. Reading from the book or the',
    '  board is NOT an answer.',
    '- beyond: a child goes beyond what was asked with a link or example of their own',
    '- content_q: a child asks a question about the content',
    '- proc_q: a child asks only about procedure ("which page?", "in the copy?")',
    '- beyond_q: a child asks a question that goes beyond the lesson',
    '',
    'WRONG ANSWERS — what happens when a child is wrong, and how safe it is to be wrong:',
    '- wrong_reason: after a child\'s wrong answer, the teacher explains why it is wrong',
    '- wrong_fixed: a child corrects their own wrong answer (quote the wrong answer — the correction)',
    '- wrong_ignored: a wrong answer is passed over with no reason ("no, anyone else?")',
    '- strategy: after a wrong answer, the teacher tries a new way (an example, a picture, a simpler question).',
    '  Moving on to the next exercise is NOT a strategy.',
    '- praise_effort: specific praise for effort or thinking ("you checked your work and found the mistake")',
    '- praise_generic: general praise ("good", "shabash", "well done")',
    '- mistake_useful: the teacher uses a child\'s mistake to teach the class',
    '- disagree: the teacher welcomes a child disagreeing',
    '- hedged: a child answers while openly unsure ("maybe", "I think", "shayad")',
    '- unprompted: a child tries without being asked, or keeps trying after a wrong answer',
    '',
    'WORKING — while the children work:',
    '- choice: the children decide something that matters (which task, how to show their work, who to work with)',
    '  and act on it. An instruction to work in pairs or groups is NOT a choice; picking which of two words to say',
    '  is NOT a real choice.',
    '- handover: a child runs part of the lesson: leads the class, asks the class questions, explains to the class,',
    '  leads a group\'s report. Answering, reading aloud or writing on the board when called is NOT a handover.',
    '  TEST: is a child doing the teacher\'s job for the whole class? A child doing the task they were given is not.',
    '',
    'EXPLAINING — the teacher\'s content:',
    '- content_error: the teacher says something factually wrong and it is not corrected',
    '- term_defined: the teacher explains or defines a subject word (not only names it)',
    '- why_explained: the teacher explains why a method or fact works, not only how. A moral lesson or a plain',
    '  definition is NOT this.',
    '  TEST: does the teacher give the reason ("because", "so that", "that is why") about the content?',
    '  The steps of a method, a definition or a general remark are not a reason.',
    '- life_link: the teacher links the content to the children\'s daily life or to another subject. The story in',
    '  the lesson, a moral or a memory trick is NOT a life link.',
    '',
    `HOW MANY: at most ${SLOTS} per part, and only the clearest. Fewer clear moments are better than many weak ones.`,
    'If a part has no clear moment, return none for it.',
    '',
    'Also count, across the whole lesson: closed_q (questions with a yes/no or one-word answer, or answered in',
    'chorus) and praise_generic (lines of general praise).',
    '',
    `The lesson is ${period} minutes; Part 1 is minute 0 to ${half}, Part 2 is minute ${half} to ${period}.`,
    '',
    'Return JSON only, in this shape:',
    '{"moments":[{"moment":"ask|wrong|work|explain","type":"<one type above>","minute":"MM:SS","quote":"<the words>","why":"<one sentence>"}],',
    ' "counts":{"closed_q":0,"praise_generic":0}}',
    `Allowed types — ask: ${list('ask')}; wrong: ${list('wrong')}; work: ${list('work')}; explain: ${list('explain')}.`,
    '',
    'TRANSCRIPT:',
    transcript,
  ].join('\n');
}

/** Keep only what the check can show: known types, real minutes, a quote and its why; SLOTS per group. */
function normalise(raw) {
  const byGroup = Object.fromEntries(GROUPS.map((g) => [g, []]));
  for (const m of Array.isArray(raw && raw.moments) ? raw.moments : []) {
    const type = String((m && m.type) || '');
    const group = GROUP_OF[type];
    const minuteRaw = String((m && m.minute) || '').trim().replace(/^\[|\]$/g, '');
    const quote = String((m && m.quote) || '').trim();
    if (!group || !/^\d{1,3}:\d{2}$/.test(minuteRaw) || !quote) continue;
    const [mm, ss] = minuteRaw.split(':');
    const why = String((m && m.why) || '').replace(/\s+/g, ' ').trim();
    byGroup[group].push({ moment: group, type, minute: `${mm.padStart(2, '0')}:${ss}`, quote: clip(quote, QUOTE_MAX), why: clip(why, WHY_MAX) });
  }
  const moments = [];
  for (const g of GROUPS) {
    byGroup[g].slice(0, SLOTS)
      .sort((a, b) => seconds(a.minute) - seconds(b.minute))
      .forEach((m, i) => moments.push({ id: `${g}_${i + 1}`, ...m, label: TYPES[g][m.type] }));
  }
  const counts = raw && raw.counts ? raw.counts : {};
  return { moments, counts: { closed_q: whole(counts.closed_q), praise_generic: whole(counts.praise_generic) } };
}

// The moments reply's output budget. Almost all of it is the model's reasoning: the JSON is ~2,000
// tokens, the median call uses ~12,000 (prod, 5-15 Oct).
const MAX_TOKENS = 16000;

async function defaultLlm(prompt, { maxTokens = MAX_TOKENS } = {}) {
  const GPT5MiniService = require('../../gpt5-mini.service');
  return GPT5MiniService.completeJson(prompt, { maxTokens, label: 'observe2.moments' });
}

// A reply as completeJson gives it ({result, usage}); a seam that hands back the bare JSON has no usage.
function unwrap(reply) {
  if (reply && typeof reply === 'object' && 'result' in reply && 'usage' in reply) return reply;
  return { result: reply, usage: null };
}

/**
 * The model's moments, asked for once more when the reply used the whole output budget. A cut-off
 * reply is not "Rumi heard nothing": on 12, 13 and 15 Oct three replies spent all 16,000 tokens, came
 * back with no moment, and were sent to the coach as four empty screens (bd-eal7zn.3). Cut off twice
 * is a failure, with the existing failure path.
 */
async function readMoments(prompt, form, llm) {
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    // eslint-disable-next-line no-await-in-loop
    const { result, usage } = unwrap(await llm(prompt, { maxTokens: MAX_TOKENS }));
    const used = usage ? Number(usage.completion_tokens) : NaN;
    if (!(used >= MAX_TOKENS)) return result;
    logToFile('[observe2] moments reply cut off at the output limit', {
      formId: form.id, attempt, maxTokens: MAX_TOKENS, ...(attempt === 1 ? { next: 'asking once more' } : {}),
    }, attempt === 1 ? 'warn' : 'error');
  }
  throw new Error('moments reply cut off at the output limit twice');
}

async function setStatus(sessionId, status) {
  const { TERMINAL_IN_FILTER } = require('../../coaching/session-terminal');
  const { data, error } = await supabase.from('coaching_sessions')
    .update({ status, updated_at: new Date().toISOString() })
    .eq('id', sessionId)
    .not('status', 'in', TERMINAL_IN_FILTER)
    .select('id');
  if (error) {
    logToFile('[observe2] session status not written', { sessionId, status, error: error.message }, 'error');
    return false;
  }
  return (data || []).length > 0;
}

// The coach's language, for the "why" of each moment. Read, never written (one writer: setUserLanguage).
async function coachLanguage(form) {
  const { data, error } = await supabase.from('users')
    .select('preferred_language').eq('id', form.observer_user_id).maybeSingle();
  if (error) logToFile('[observe2] the coach\'s language could not be read: the moments\' "why" uses the default', { formId: form.id, error: error.message }, 'warn');
  return clampLanguage(data && data.preferred_language);
}

async function coachOf(form) {
  const { data, error } = await supabase.from('users')
    .select('phone_number, preferred_language').eq('id', form.observer_user_id).maybeSingle();
  if (error || !data || !data.phone_number) {
    logToFile('[observe2] the coach could not be found to message', { formId: form.id, error: error && error.message }, 'error');
    return null;
  }
  return data;
}

async function tell(form, key) {
  const coach = await coachOf(form);
  if (!coach) return false;
  return WhatsAppService.sendMessage(coach.phone_number, observe2Strings(coach.preferred_language)[key]);
}

/** Send the check to the coach. @returns {Promise<boolean>} */
async function openCheck(form) {
  const flowId = process.env.OBSERVE2_CHECK_FLOW_ID;
  if (!flowId) {
    logToFile('[observe2] the check cannot open: OBSERVE2_CHECK_FLOW_ID is not set', { formId: form.id }, 'error');
    return false;
  }
  const coach = await coachOf(form);
  if (!coach) return false;
  const S = observe2Strings(coach.preferred_language);
  const n = ((form.rumi_moments && form.rumi_moments.moments) || []).length;
  const sent = await WhatsAppService.sendFlow(coach.phone_number, {
    flowId,
    body: S.check_body(n),
    buttonText: S.check_cta,
    flowToken: `${form.observer_user_id}:observe2-check:${form.id}`,
  });
  if (!sent) logToFile('[observe2] the check did not send', { formId: form.id }, 'error');
  else logToFile('[observe2] check sent', { formId: form.id, moments: n });
  return sent;
}

// /observe reads each classroom photo once with the v2 vision pass and hands what it saw to the plan
// grader (analysis-processor, D34), under COACHING_PHOTO_VISION=v2 and LP_FIDELITY_PHOTO. The same here,
// for the photos the coach stored at the seal: numbered as taken, a photo that is not a classroom photo
// (or carries writing addressed to a grader) left out, and the same 90-second reading budget.
const PHOTO_READ_BUDGET_MS = 90000;
async function photoEvidence(form, deps = {}) {
  const F = require('../../coaching/fidelity/fidelity-orchestrator');
  if (!F.isPhotoEvidenceOn()) return [];
  if (String(process.env.COACHING_PHOTO_VISION || '').trim().toLowerCase() !== 'v2') return [];
  const keys = Array.isArray(form.photos) ? form.photos : [];
  if (!keys.length) return [];
  const download = deps.download || ((key) => require('../../../storage/r2').downloadFromR2(key));
  const read = deps.read || ((buf, mime, ctx) => require('../../coaching/classroom-photo/photo-analysis.service').analyzeClassroomPhotoV2(buf, mime, ctx));
  const started = Date.now();
  const evidence = [];
  for (const [i, key] of keys.entries()) {
    const n = i + 1;
    if (Date.now() - started > PHOTO_READ_BUDGET_MS) {
      logToFile('[observe2] photo reading budget spent: photo left out of the plan grading', { formId: form.id, photo: n });
      continue;
    }
    try {
      // eslint-disable-next-line no-await-in-loop
      const r = await read(await download(key), 'image/jpeg', { formId: form.id, photo: n });
      if (r && r.ok && !r.exclude && r.evidence) evidence.push({ n, ...r.evidence });
    } catch (err) {
      logToFile('[observe2] a classroom photo could not be read for the plan grading', { formId: form.id, photo: n, error: err.message }, 'error');
    }
  }
  return evidence;
}

/**
 * Grade the lesson plan against the transcript with the fidelity orchestrator /observe uses: the same
 * move lists, grader, runs, photo evidence and scorer.
 *   - a plan picked from the list (answers.lp_ref): the bot's own move list for it (corpus);
 *   - a plan the coach added (answers.lp_upload): read the way /observe reads an uploaded plan, then the
 *     orchestrator's uploaded-plan path. One that can't be read, or doesn't read as a lesson plan, is not
 *     graded and says which (lp_unreadable / lp_not_lesson_plan), so the brief can tell the coach.
 * @returns {Promise<object|null>} null when there is no plan to grade or LP_FIDELITY_ENABLED is off.
 */
async function gradeFidelity(form, transcript, audioDurationSeconds, fidelityDeps, planDeps, photoDeps) {
  const a = form.answers || {};
  const ref = a.lp_ref && a.lp_ref.lesson_id ? a.lp_ref : null;
  const added = !ref && a.lp_upload && a.lp_upload.kind ? a.lp_upload : null;
  if (!ref && !added) return null;
  const graded = (out) => ({ ...out, graded_at: new Date().toISOString() });
  try {
    const F = require('../../coaching/fidelity/fidelity-orchestrator');
    if (!F.isFidelityEnabled()) {
      logToFile('[observe2] a plan was given but LP_FIDELITY_ENABLED is off: fidelity not graded', { formId: form.id }, 'warn');
      return null;
    }
    let input;
    let planSource = null;
    if (ref) {
      input = {
        corpusKey: { lesson_id: ref.lesson_id, version_stamp: ref.version_stamp, content_hash: ref.content_hash },
        meta: { lesson_id: ref.lesson_id, ...(ref.subject ? { subject: ref.subject } : {}), ...(ref.grade ? { grade: ref.grade } : {}) },
      };
    } else {
      const P = require('./added-plan');
      const files = P.sharedDownloads(planDeps);
      // A file that is one of Rumi's own plans is graded from that plan's steps, like a pick (bd-eal7zn.2).
      const rumiPlan = await P.matchRumiPlan(added, files);
      if (rumiPlan) {
        const { parseCorpusLessonId } = require('../../coaching/subject-resolution');
        const parsed = parseCorpusLessonId(rumiPlan.lesson_id) || {};
        const versioned = rumiPlan.asset_kind === 'lesson';
        planSource = { kind: added.kind, files: Array.isArray(added.keys) ? added.keys.length : 0, rumi_plan: rumiPlan };
        logToFile("[observe2] the added lesson plan is one of the bot's own plans: graded from its steps", {
          formId: form.id, lessonId: rumiPlan.lesson_id, assetId: rumiPlan.asset_id, kind: rumiPlan.asset_kind,
        });
        input = {
          corpusKey: {
            lesson_id: rumiPlan.lesson_id,
            version_stamp: versioned ? rumiPlan.version_stamp : null,
            content_hash: versioned ? rumiPlan.content_hash : null,
          },
          meta: { lesson_id: rumiPlan.lesson_id, ...(parsed.subject ? { subject: parsed.subject } : {}), ...(parsed.grade ? { grade: String(parsed.grade) } : {}) },
        };
      } else {
        const read = await P.readAddedPlan(added, files);
        planSource = { kind: read.kind, files: read.files, read: read.read, parsers: read.parsers, chars: read.text.length };
        if (!read.text) {
          logToFile('[observe2] the added lesson plan could not be read: not graded', { formId: form.id, ...planSource }, 'error');
          return graded({ status: 'lp_unreadable', plan_source: planSource });
        }
        if (await P.looksLikeLessonPlan(read.text, files) === false) {
          logToFile('[observe2] the added lesson plan does not read as a lesson plan: not graded', { formId: form.id, ...planSource }, 'warn');
          return graded({ status: 'lp_not_lesson_plan', plan_source: planSource });
        }
        input = { uploadedText: read.text, meta: {} };
      }
    }
    const photos = await photoEvidence(form, photoDeps);
    const out = await F.computeLpFidelity({
      ...input, transcript, audioDurationSeconds: audioDurationSeconds || null, ...(photos.length ? { photoEvidence: photos } : {}),
    }, fidelityDeps || {});
    if (!out) return null;
    if (out.status !== 'ok') logToFile('[observe2] fidelity not graded', { formId: form.id, status: out.status, error: out.error || null }, 'error');
    return graded({ ...out, ...(planSource ? { plan_source: planSource } : {}) });
  } catch (err) {
    logToFile('[observe2] fidelity grading threw', { formId: form.id, error: err.message }, 'error');
    return { status: 'fidelity_unavailable', error: err.message };
  }
}

async function finish(sessionId, form) {
  if (!form.sealed_at) {
    await setStatus(sessionId, 'observe2_ready');
    return { handled: true, action: 'waiting_for_seal' };
  }
  if (form.checked_at) {
    // The check handed the visit to /observe's debrief (observer_review_complete and on): a late
    // moments job must not write over that.
    return { handled: true, action: 'already_checked' };
  }
  const sent = await openCheck(form);
  await setStatus(sessionId, sent ? 'observe2_checking' : 'observe2_ready');
  return { handled: true, action: sent ? 'check_sent' : 'check_not_sent' };
}

/**
 * After transcription. @returns {Promise<{handled:boolean, action?:string}>} handled:false → not an
 * /observe2 recording; the classic path goes on.
 */
async function runForSession(sessionId, from, deps = {}) {
  const linked = await Store.findBySession(sessionId);
  if (!linked.ok || !linked.form) return { handled: false };
  let form = linked.form;

  if (form.moments_ready_at) {
    logToFile('[observe2] moments already stored; not read again', { sessionId, formId: form.id });
    return finish(sessionId, form);
  }
  if (!(await setStatus(sessionId, 'observe2_moments'))) {
    logToFile('[observe2] the session is over; moments not read', { sessionId, formId: form.id }, 'warn');
    return { handled: true, action: 'session_closed' };
  }

  const { data: row, error } = await supabase.from('coaching_sessions')
    .select('transcript_text, audio_duration_seconds').eq('id', sessionId).maybeSingle();
  const transcript = (row && row.transcript_text) || '';
  if (error || !TIMED_RX.test(transcript)) {
    logToFile('❌ [observe2] no timed transcript: moments not read', {
      sessionId, formId: form.id, error: error && error.message, length: transcript.length,
    }, 'error');
    await setStatus(sessionId, 'observe2_no_timestamps');
    await tell(form, 'moments_untimed');
    return { handled: true, action: 'untimed' };
  }

  try {
    // The plan's fidelity is graded from the same transcript, at the same time, by the grader /observe
    // uses. It never fails the moments: the orchestrator returns a status instead of throwing. The plan
    // is locked only by the seal, so a recording that comes first leaves the grading to the seal
    // (onSealed): graded now, it would miss a plan attached after it (Riffat, 4 Oct).
    const sealed = Boolean(form.sealed_at);
    const lang = await coachLanguage(form);
    const [raw, fidelity] = await Promise.all([
      readMoments(buildPrompt(transcript, form, { lang }), form, deps.llm || defaultLlm),
      sealed ? gradeFidelity(form, transcript, row && row.audio_duration_seconds, deps.fidelityDeps, deps.planDeps, deps.photoDeps) : null,
    ]);
    // Every quote is checked against the transcript before the coach sees it (quote-check.js); what was
    // dropped, repaired or re-timed is counted, stored and logged on its own line.
    const known = (Array.isArray(raw && raw.moments) ? raw.moments : []).filter((m) => m && GROUP_OF[m.type]);
    const checked = checkQuotes(known, transcript);
    const { stats } = checked;
    logToFile('[observe2] moments checked against the transcript', {
      sessionId, formId: form.id, ...stats,
    }, stats.returned && stats.kept * 2 < stats.returned ? 'warn' : 'info');
    const { moments, counts } = normalise({ ...(raw || {}), moments: checked.moments });
    const stored = await Store.setMoments(form.id, {
      moments, counts, prompt_version: PROMPT_VERSION, verified: stats, fidelity, ...(sealed ? {} : { fidelity_at_seal: true }),
    }, heardLevels(moments, counts));
    if (!stored.ok) throw new Error(stored.error || 'moments not stored');
    const again = await Store.getForm(form.id);
    form = (again.ok && again.form) || form;
    // Sealed while the moments were being read: onSealed found no moments then, so grade it here.
    if (!sealed && form.sealed_at && form.rumi_moments && form.rumi_moments.fidelity_at_seal) {
      form = await gradeAtSeal(form, deps);
    }
    logToFile('[observe2] moments stored', {
      sessionId, formId: form.id, moments: moments.length,
      fidelity: fidelity ? fidelity.status : 'no_plan', fidelityPct: fidelity && fidelity.fidelity_pct != null ? fidelity.fidelity_pct : null,
    });
  } catch (err) {
    logToFile('❌ [observe2] moments failed', { sessionId, formId: form.id, error: err.message }, 'error');
    await setStatus(sessionId, 'observe2_failed');
    await tell(form, 'moments_failed');
    return { handled: true, action: 'failed' };
  }
  return finish(sessionId, form);
}

/**
 * The plan for a recording that came before the seal, graded now that the seal has locked it.
 * The result is stored with the moments; a failure is a status, never a lost check.
 */
async function gradeAtSeal(form, deps = {}) {
  // The record as it is now: photos stored at the photo step may have landed after the caller read it.
  const fresh = await Store.getForm(form.id);
  if (fresh.ok && fresh.form) form = fresh.form;
  const { data: row, error } = await supabase.from('coaching_sessions')
    .select('transcript_text, audio_duration_seconds').eq('id', form.coaching_session_id).maybeSingle();
  if (error || !row) {
    logToFile('[observe2] the recording could not be read to grade the plan at the seal', { formId: form.id, error: error && error.message }, 'error');
    return form;
  }
  const fidelity = await gradeFidelity(form, row.transcript_text || '', row.audio_duration_seconds, deps.fidelityDeps, deps.planDeps, deps.photoDeps);
  const { fidelity_at_seal: _waited, ...rest } = form.rumi_moments || {};
  const stored = await Store.setRumiMoments(form.id, { ...rest, fidelity });
  logToFile('[observe2] plan graded at the seal', {
    formId: form.id, fidelity: fidelity ? fidelity.status : 'no_plan', stored: stored.ok,
    fidelityPct: fidelity && fidelity.fidelity_pct != null ? fidelity.fidelity_pct : null,
  });
  const again = await Store.getForm(form.id);
  return (again.ok && again.form) || { ...form, rumi_moments: { ...rest, fidelity } };
}

/** After the seal: the moments may already be in (the recording came first). */
async function onSealed(form, deps = {}) {
  if (!form || !form.moments_ready_at || form.checked_at) return false;
  if (form.rumi_moments && form.rumi_moments.fidelity_at_seal && form.coaching_session_id) {
    try {
      form = await gradeAtSeal(form, deps);
    } catch (err) {
      logToFile('[observe2] grading the plan at the seal threw', { formId: form.id, error: err.message }, 'error');
    }
  }
  const sent = await openCheck(form);
  if (sent && form.coaching_session_id) await setStatus(form.coaching_session_id, 'observe2_checking');
  return sent;
}

module.exports = {
  PROMPT_VERSION, SLOTS, WHY_MAX, TYPES, GROUPS,
  buildPrompt, normalise, runForSession, openCheck, onSealed, setStatus,
  // For the test that proves its default reader is /observe's (added-plan-defaults.test.js).
  __photoEvidence: photoEvidence,
};
