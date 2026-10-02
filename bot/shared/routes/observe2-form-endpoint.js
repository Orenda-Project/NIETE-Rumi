'use strict';

/**
 * /observe2 — the live field form's endpoint (POST /api/flows/observe2-form).
 *
 * Token: <coachUserId>:observe2-form:<recordId>. Every request re-reads the record and checks that
 * it belongs to the coach in the token.
 *
 *   INIT      a new form → PART_ONE; a reopened one → CONTINUE, saying where the record stands
 *             (INIT may only answer with an entry screen, so Part 2 cannot be opened directly).
 *   PART_ONE    checked (rules.validate) → refused under the field, or saved with the server time → PART_TWO
 *   PART_TWO    checked against Part 1 (children who had not spoken yet) → saved → LESSON_PLAN
 *   LESSON_PLAN the teacher's own recent plans from the bot, plus "Not in this list"; the pick is saved
 *               with the keys the fidelity grader resolves the plan's moves by → AFTER, which names it
 *               (the coach goes back to change it; the plan is locked with the seal)
 *   AFTER     checked → sealed once (compare-and-set) → SEALED; then, after the response, the
 *             recording steps go to the chat, the check opens if the recording's moments are
 *             already in, and up to ten photos are stored.
 *   CONTINUE  → PART_TWO, LESSON_PLAN, AFTER or SEALED, from the record.
 *
 * The screens are English for the pilot; the chat message after the seal is in the coach's language.
 */

const supabase = require('../config/supabase');
const Store = require('../services/observe/observe2/field-form.store');
const { validate } = require('../services/observe/observe2/rules');
const { FIELDS, MAX_PHOTOS } = require('../services/observe/observe2/field-form.flow');
const { observe2Strings } = require('../services/observe/observe2/strings');
const { logToFile } = require('../utils/logger');

const DEFAULT_PERIOD = 40;
const NOT_IN_LIST = 'other';
const NO_ERRORS = { error_messages: {}, error: '', has_error: false };

function parseToken(flowToken) {
  const [userId, marker, recordId] = String(flowToken || '').split(':');
  if (!userId || marker !== 'observe2-form' || !recordId) return null;
  return { userId, recordId };
}

function clock(iso) {
  let timeZone = 'UTC';
  try {
    timeZone = require('../services/observe/observe-debrief.service').displayTimeZone() || 'UTC';
  } catch (err) {
    logToFile('[observe2] display time zone unavailable, using UTC', { error: err.message }, 'warn');
  }
  try {
    return new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', timeZone }).format(new Date(iso));
  } catch (_) {
    return String(iso || '').slice(11, 16);
  }
}

const halves = (form) => {
  const period = Number(form && form.period_minutes) || DEFAULT_PERIOD;
  return { period, half: Math.round(period / 2) };
};

async function teacherName(form) {
  if (!form.teacher_user_id) return null;
  const { data, error } = await supabase.from('users').select('name').eq('id', form.teacher_user_id).maybeSingle();
  if (error) {
    logToFile('[observe2] teacher name lookup failed', { formId: form.id, error: error.message }, 'error');
    return null;
  }
  return (data && data.name) || null;
}

/** Load the record for this token; null when it is missing or not this coach's. */
async function loadForm(flowToken) {
  const t = parseToken(flowToken);
  if (!t) return { ok: true, form: null };
  const got = await Store.getForm(t.recordId);
  if (!got.ok) return { ok: false };
  const form = got.form && got.form.observer_user_id === t.userId ? got.form : null;
  return { ok: true, form, userId: t.userId };
}

// ------------------------------------------------------------------ screens

async function renderPart1(form, extra = {}) {
  const { period, half } = halves(form);
  const name = await teacherName(form);
  return {
    screen: 'PART_ONE',
    data: {
      teacher_line: name ? `Teacher: ${name} · ${period}-minute period` : `${period}-minute period`,
      part_hint: `Minute 0 to ${half}. At minute ${half}, tap "Part 1 done": your answers are saved then.`,
      ...NO_ERRORS,
      ...extra,
    },
  };
}

function renderPart2(form, extra = {}) {
  const { period, half } = halves(form);
  return {
    screen: 'PART_TWO',
    data: {
      part_hint: `From minute ${half} to ${period}. Answer only for what happens in this part.`,
      ...NO_ERRORS,
      ...extra,
    },
  };
}

const clip = (text, n) => {
  const chars = [...String(text == null ? '' : text)];
  return chars.length <= n ? chars.join('') : `${chars.slice(0, n - 1).join('')}…`;
};

// The teacher's most recent lesson plans from the bot (the same source as /observe's list), newest
// first. A failure is logged and reads as an empty list: the coach can still say "Not in this list".
async function recentPlans(form) {
  if (!form || !form.teacher_user_id) return [];
  try {
    const { getRecentFidelityLps } = require('../services/coaching/lp-coaching/recent-fidelity-lps.service');
    return await getRecentFidelityLps(form.teacher_user_id);
  } catch (err) {
    logToFile('[observe2] the teacher\'s recent plans could not be read', { formId: form.id, error: err.message }, 'error');
    return [];
  }
}

function planOption(row) {
  const { formatLpRow } = require('../services/coaching/lp-coaching/lp-selection-format');
  const f = formatLpRow(row);
  return { id: String(row.id), title: clip(row.topic || f.title, 30), description: f.description };
}

async function renderPlan(form, extra = {}, plans) {
  const list = plans || await recentPlans(form);
  const name = form ? await teacherName(form) : null;
  const who = name || 'The teacher';
  const hint = list.length
    ? `${name ? `${name}'s` : "The teacher's"} most recent plans from the bot. If the plan isn't here, pick "Not in this list".`
    : `${who} has no plans from the bot yet. Pick "Not in this list".`;
  return {
    screen: 'LESSON_PLAN',
    data: {
      lp_hint: hint,
      lp_options: [...list.map(planOption), { id: NOT_IN_LIST, title: 'Not in this list', description: "A paper plan, or one this teacher didn't get from the bot" }],
      ...NO_ERRORS,
      ...extra,
    },
  };
}

function planLine(answers) {
  const a = answers || {};
  const back = ' To change it, go back.';
  if (a.lp === 'none') return `Lesson plan: there was no lesson plan for this lesson.${back}`;
  if (a.lp_ref && a.lp_ref.label) {
    return `Lesson plan: ${a.lp_ref.label}.${a.lp === 'notfollowed' ? ' You said it was not followed.' : ''}${back}`;
  }
  if (a.lp) return `Lesson plan: not in the list, so the recording can't be checked against it.${back}`;
  return '';
}

function renderAfter(form, extra = {}) {
  return { screen: 'AFTER', data: { lp_line: planLine(form && form.answers), ...NO_ERRORS, ...extra } };
}

function renderSealed(form, lines) {
  const l = lines || {
    sealed_line: `Sealed at ${clock(form.sealed_at)}`,
    next_line: 'Next: stop the recorder and send the recording in the chat. The steps are waiting there.',
  };
  return { screen: 'SEALED', data: { ...l, record_id: String((form && form.id) || '') } };
}

function renderContinue(kind, form) {
  const { period, half } = halves(form);
  const text = {
    part1: ['Part 1 is saved', `Carry on with Part 2, from minute ${half} to ${period}.`],
    plan: ['Parts 1 and 2 are saved', 'Next: the lesson plan, then seal the record.'],
    part2: ['Parts 1 and 2 and the plan are saved', 'Carry on to the last screen and seal the record.'],
    sealed: ['This record is sealed', `It was sealed at ${clock(form && form.sealed_at)} and can't change. Send the recording in the chat if you haven't yet.`],
    gone: ['This form is not available', 'Send /observe2 in the chat to start a new visit.'],
    error: ['Something went wrong', 'Close this form and open it again in a minute.'],
  }[kind];
  return { screen: 'CONTINUE', data: { continue_heading: text[0], continue_line: text[1] } };
}

// Validation failures, shown under each field and once at the bottom.
function refused(errors) {
  const n = Object.keys(errors).length;
  return { error_messages: errors, error: n === 1 ? 'One answer needs a look.' : `${n} answers need a look.`, has_error: true };
}

// ------------------------------------------------------------------ after the seal

async function storePhotos(form, photos) {
  const { decryptMedia } = require('../services/roster/roster-media');
  const { uploadBuffer } = require('../storage/r2');
  const keys = [];
  for (let i = 0; i < Math.min(photos.length, MAX_PHOTOS); i += 1) {
    try {
      // eslint-disable-next-line no-await-in-loop
      const media = await decryptMedia(photos[i]);
      const key = `observe2/${form.id}/photo-${i + 1}.jpg`;
      // eslint-disable-next-line no-await-in-loop
      await uploadBuffer(media.data, key, 'image/jpeg');
      keys.push(key);
    } catch (err) {
      logToFile('[observe2] a photo was not stored', { formId: form.id, index: i, error: err.message }, 'error');
    }
  }
  if (keys.length) await Store.setPhotos(form.id, keys);
  return keys;
}

async function afterSeal(form, photos) {
  try {
    const { data: coach, error } = await supabase.from('users')
      .select('phone_number, preferred_language').eq('id', form.observer_user_id).maybeSingle();
    if (error || !coach) {
      logToFile('[observe2] sealed, but the coach could not be messaged', { formId: form.id, error: error && error.message }, 'error');
    } else {
      const WhatsAppService = require('../services/whatsapp.service');
      const S = observe2Strings(coach.preferred_language);
      const time = clock(form.sealed_at);
      await WhatsAppService.sendMessage(coach.phone_number,
        form.coaching_session_id ? S.sealed_chat_recording_in(time) : S.sealed_chat(time));
    }
  } catch (err) {
    logToFile('[observe2] the after-seal message failed', { formId: form.id, error: err.message }, 'error');
  }
  // The recording may have come first: then its moments are in, and the check opens now.
  try {
    await require('../services/observe/observe2/moments').onSealed(form);
  } catch (err) {
    logToFile('[observe2] opening the check after the seal failed', { formId: form.id, error: err.message }, 'error');
  }
  if (Array.isArray(photos) && photos.length) {
    try { await storePhotos(form, photos); } catch (err) {
      logToFile('[observe2] storing photos failed', { formId: form.id, error: err.message }, 'error');
    }
  }
}

// ------------------------------------------------------------------ handlers

async function handleObserve2FormInit(flowToken) {
  const loaded = await loadForm(flowToken);
  if (!loaded.ok) return renderContinue('error');
  const form = loaded.form;
  if (!form) {
    logToFile('[observe2] form opened with a token that matches no record of this coach', { flowToken: String(flowToken || '').split(':').slice(1).join(':') }, 'warn');
    return renderContinue('gone');
  }
  await Store.markOpened(form.id);
  if (form.sealed_at) return renderContinue('sealed', form);
  if (form.part2_done_at) return renderContinue((form.answers || {}).lp ? 'part2' : 'plan', form);
  if (form.part1_done_at) return renderContinue('part1', form);
  return renderPart1(form);
}

async function handleObserve2FormDataExchange(flowToken, screen, screenData = {}) {
  const loaded = await loadForm(flowToken);
  const form = loaded.ok ? loaded.form : null;
  const step = (screenData && screenData.screen) || screen;

  if (step === 'CONTINUE') {
    if (!form || form.sealed_at) return renderSealed(form, form ? null : { sealed_line: 'Nothing to fill in', next_line: 'Send /observe2 in the chat to start a new visit.' });
    if (form.part2_done_at) return (form.answers || {}).lp ? renderAfter(form) : renderPlan(form);
    return renderPart2(form);
  }

  if (!loaded.ok) {
    const again = { error: 'Something went wrong on our side. Tap the button again.', has_error: true };
    if (step === 'PART_TWO') return renderPart2(null, again);
    if (step === 'LESSON_PLAN') return renderPlan(null, again, []);
    if (step === 'AFTER') return renderAfter(null, again);
    return { screen: 'PART_ONE', data: { teacher_line: '', part_hint: '', ...NO_ERRORS, ...again } };
  }
  if (!form) {
    const gone = { error: 'This form is not available. Close it and send /observe2 in the chat.', has_error: true };
    if (step === 'PART_TWO') return renderPart2(null, gone);
    if (step === 'LESSON_PLAN') return renderPlan(null, gone, []);
    if (step === 'AFTER') return renderAfter(null, gone);
    return { screen: 'PART_ONE', data: { teacher_line: '', part_hint: '', ...NO_ERRORS, ...gone } };
  }

  if (step === 'PART_ONE' || step === 'PART_TWO') {
    const part = step === 'PART_ONE' ? 'p1' : 'p2';
    const answers = Store.pick(screenData, FIELDS[step]);
    const errors = validate(step, { ...(form.answers || {}), ...answers });
    const render = step === 'PART_ONE' ? (extra) => renderPart1(form, extra) : (extra) => renderPart2(form, extra);
    if (Object.keys(errors).length) return render(refused(errors));
    const saved = await Store.savePart(form, part, answers);
    if (!saved.ok) {
      return render({ error: saved.sealed ? 'This record is already sealed. Close the form.' : 'Not saved. Tap the button again.', has_error: true });
    }
    logToFile('[observe2] part saved', { formId: form.id, part });
    return step === 'PART_ONE' ? renderPart2(saved.form) : renderPlan(saved.form);
  }

  if (step === 'LESSON_PLAN') {
    const answers = Store.pick(screenData, FIELDS.LESSON_PLAN);
    const plans = await recentPlans(form);
    const errors = validate('LESSON_PLAN', { ...answers, has_plans: plans.length > 0 });
    if (Object.keys(errors).length) return renderPlan(form, refused(errors), plans);
    let lpRef = null;
    if (answers.lp !== 'none' && answers.lp_pick && answers.lp_pick !== NOT_IN_LIST) {
      const row = plans.find((r) => String(r.id) === answers.lp_pick);
      if (!row) return renderPlan(form, refused({ lp_pick: 'That plan is no longer in the list. Pick again.' }), plans);
      const opt = planOption(row);
      lpRef = {
        asset_id: String(row.asset_id || row.id),
        lesson_id: row.lesson_id,
        version_stamp: row.version_stamp || null,
        content_hash: row.content_hash || null,
        grade: row.grade == null ? null : String(row.grade),
        subject: row.subject || null,
        label: `${row.topic || opt.title}, ${opt.description}`,
      };
    }
    const toSave = answers.lp === 'none' ? { lp: 'none' } : answers;
    const saved = await Store.savePlan(form, toSave, lpRef);
    if (!saved.ok) {
      return renderPlan(form, { error: saved.sealed ? 'This record is already sealed. Close the form.' : 'Not saved. Tap Next again.', has_error: true }, plans);
    }
    logToFile('[observe2] lesson plan saved', { formId: form.id, lp: answers.lp, lessonId: lpRef && lpRef.lesson_id });
    return renderAfter(saved.form);
  }

  if (step === 'AFTER') {
    const answers = Store.pick(screenData, FIELDS.AFTER);
    const errors = validate('AFTER', { ...answers, seal_ok: screenData.seal_ok });
    if (Object.keys(errors).length) return renderAfter(form, refused(errors));
    const sealed = await Store.seal(form, answers);
    if (sealed.alreadySealed) return renderSealed(sealed.form);
    if (!sealed.ok) return renderAfter(form, { error: 'Not sealed. Tap "Seal and send" again.', has_error: true });
    logToFile('[observe2] record sealed', { formId: form.id, photos: Array.isArray(screenData.photos) ? screenData.photos.length : 0 });
    const photos = Array.isArray(screenData.photos) ? screenData.photos : [];
    setImmediate(() => { afterSeal(sealed.form, photos); });
    return renderSealed(sealed.form);
  }

  logToFile('[observe2] unknown screen in data_exchange', { screen: step }, 'warn');
  return renderContinue('error');
}

module.exports = {
  MAX_PHOTOS,
  parseToken,
  handleObserve2FormInit,
  handleObserve2FormDataExchange,
};
