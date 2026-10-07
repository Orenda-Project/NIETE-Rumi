'use strict';

/**
 * The item's OWN recorded clips for the web page (E2 `audio`).
 *
 * Video-bank listen items ("یہ کس کی آواز ہے؟" with options نُ / پَ) keep
 * the sound to identify in media.stimulus_audio, the spoken question in
 * media.question_audio and the spoken why in media.explanation_audio. On
 * WhatsApp those are voice notes; on the page they must arrive as presigned
 * URLs or the child sees the letters and never hears the sound.
 *
 * The page plays `stim` behind its "Play the sound" button BEFORE the answer, so
 * it is sent only when the stem hands the question to a sound. A stem that
 * already asks the question ("When the switch is open…") means the clip speaks
 * the answer: it is not sent.
 *
 * The bank's own recorded voices come first: a recorded question clip
 * (media.question_audio) and recorded option clips (media.option_audio,
 * [{ index, url }], index = the option's stored slot, so the page's shuffle can
 * never pair a clip with another option) win over the generated read-aloud
 * clips (meta.web.audio) for the same part. Options are all recorded or all
 * generated within one question: one voice across a question's options. The
 * why stays generated where both exist. With neither, the page reads aloud.
 */

const { logToFile } = require('../../utils/logger');

// The WhatsApp rule (video-quiz-render LISTEN_AND_IDENTIFY), plus stems that
// ask about something only the clip carries, as the bank words them: "the word
// with the following sound:", "the word that sounds like:", "the first letter of
// this word", «یہ کس حرف کی آواز ہے؟», «روٹی جیسی آواز کس کی ہے؟», «یہ لفظ کیسے
// لکھتے ہیں؟». NOT a stem that merely says "following" ("Which of the following
// is a noun?") or talks about sound ("Musical sounds are:"): in those the clip in
// this slot speaks the answer (R20). A statement (it ends with a full stop) only
// mentions sounds; its clip says the answer.
const ASKS_ABOUT_THE_CLIP = /\bthe following sound\b|\bsounds? like\b|\bthis word\b|\bhear\b|(?:کی|کس)\s*آواز\s*ہے|جیسی\s*آواز|آواز\s*کس\s*جیسی|سنیں|سنو|یہ لفظ|کون سا لفظ ہے|اس لفظ/i;
const IS_STATEMENT = /[.۔]\s*$/;

function stemAsksForSound(stem) {
  const s = String(stem || '').trim();
  let listen = false;
  try { listen = require('./video-quiz-render.service').isListenAndIdentify(s); } catch { listen = false; }
  return listen || (ASKS_ABOUT_THE_CLIP.test(s) && !IS_STATEMENT.test(s));
}

const OPTION_FIELDS = ['option_a', 'option_b', 'option_c', 'option_d'];

/**
 * The recorded option clips by stored slot ([a, b, c, d], null where there is no option), or null
 * unless EVERY option the row shows has its own clip.
 */
function recordedOptions(row) {
  const list = Array.isArray(row && row.media && row.media.option_audio) ? row.media.option_audio : [];
  const byIndex = new Map(list
    .filter((o) => o && Number.isInteger(o.index) && o.index >= 0 && o.index < 4 && typeof o.url === 'string' && o.url)
    .map((o) => [o.index, o.url]));
  const shown = [0, 1, 2, 3].filter((i) => row[OPTION_FIELDS[i]] != null && String(row[OPTION_FIELDS[i]]).trim() !== '');
  if (!shown.length || !shown.every((i) => byIndex.has(i))) return null;
  return [0, 1, 2, 3].map((i) => (shown.includes(i) ? byIndex.get(i) : null));
}

/** The recorded clip URLs a row carries for the page: {q?, opts?, stim?, why?}. */
function recordedClips(row) {
  const m = (row && row.media) || {};
  const out = {};
  const qa = Array.isArray(m.question_audio) ? m.question_audio.find((u) => typeof u === 'string' && u) : null;
  if (qa) out.q = qa;
  const opts = recordedOptions(row || {});
  if (opts) out.opts = opts;
  if (typeof m.stimulus_audio === 'string' && m.stimulus_audio && stemAsksForSound(row.question_text)) out.stim = m.stimulus_audio;
  if (typeof m.explanation_audio === 'string' && m.explanation_audio) out.why = m.explanation_audio;
  return out;
}

async function presign(url, expiresIn) {
  try {
    const r2 = require('../../storage/r2');
    return (await r2.getPresignedUrl(url, expiresIn)) || null;
  } catch (e) {
    logToFile('⚠️ web-quiz: recorded clip not signed, the page reads aloud instead', { error: e.message });
    return null;
  }
}

/** The parts the publish step need not record for a row: its recorded question and options ('q', 'a'..'d'). */
function recordedParts(row) {
  const clips = recordedClips(row);
  const parts = new Set();
  if (clips.q) parts.add('q');
  if (clips.opts) clips.opts.forEach((u, i) => { if (u) parts.add('abcd'.charAt(i)); });
  return parts;
}

// Recorded WINS for these; for the why a generated clip is kept.
const RECORDED_FIRST = new Set(['q', 'stim']);

/**
 * Merge each row's recorded clips into the generated audio map (qid → {q, opts, why}).
 * A recorded question / sound wins over a generated one; recorded options replace the generated
 * ones only when every option's clip could be signed; a clip that cannot be signed is left out.
 */
async function withRecordedClips(rows, generated, { expiresIn } = {}) {
  const out = { ...(generated || {}) };
  await Promise.all((rows || []).map(async (row) => {
    const clips = recordedClips(row);
    const keys = Object.keys(clips);
    if (!keys.length) return;
    const entry = { opts: [], ...(out[row.id] || {}) };
    await Promise.all(keys.map(async (k) => {
      if (k === 'opts') {
        const signed = await Promise.all(clips.opts.map((u) => (u ? presign(u, expiresIn) : null)));
        if (clips.opts.every((u, i) => !u || signed[i])) entry.opts = signed;
        return;
      }
      if (entry[k] && !RECORDED_FIRST.has(k)) return;
      const url = await presign(clips[k], expiresIn);
      if (url) entry[k] = url;
    }));
    out[row.id] = entry;
  }));
  return out;
}

module.exports = { withRecordedClips, recordedClips, recordedOptions, recordedParts, stemAsksForSound };
