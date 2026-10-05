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
 * the answer: it is not sent. A generated read-aloud clip (meta.web.audio) wins
 * over a recorded one for the same field; with neither, the page reads aloud.
 */

const { logToFile } = require('../../utils/logger');

// The WhatsApp rule (video-quiz-render LISTEN_AND_IDENTIFY), plus stems that
// ask about something only the clip carries: "which sound is this?", "how is
// this word written?", "the word with the following sound:". A statement (it
// ends with a full stop) only mentions sounds; its clip says the answer.
const ASKS_ABOUT_THE_CLIP = /\bsounds?\b|\bhear\b|\bthis word\b|\bfollowing\b|آواز|سنیں|سنو|یہ لفظ|کون سا لفظ|اس لفظ/i;
const IS_STATEMENT = /[.۔]\s*$/;

function stemAsksForSound(stem) {
  const s = String(stem || '').trim();
  let listen = false;
  try { listen = require('./video-quiz-render.service').isListenAndIdentify(s); } catch { listen = false; }
  return listen || (ASKS_ABOUT_THE_CLIP.test(s) && !IS_STATEMENT.test(s));
}

/** The recorded clip URLs a row carries for the page: {q?, stim?, why?}. */
function recordedClips(row) {
  const m = (row && row.media) || {};
  const out = {};
  const qa = Array.isArray(m.question_audio) ? m.question_audio.find((u) => typeof u === 'string' && u) : null;
  if (qa) out.q = qa;
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

/**
 * Merge each row's recorded clips into the generated audio map (qid → {q, opts, why}).
 * A field the generated map already fills is kept; a clip that cannot be signed is left out.
 */
async function withRecordedClips(rows, generated, { expiresIn } = {}) {
  const out = { ...(generated || {}) };
  await Promise.all((rows || []).map(async (row) => {
    const clips = recordedClips(row);
    const keys = Object.keys(clips);
    if (!keys.length) return;
    const entry = { opts: [], ...(out[row.id] || {}) };
    await Promise.all(keys.map(async (k) => {
      if (entry[k]) return;
      const url = await presign(clips[k], expiresIn);
      if (url) entry[k] = url;
    }));
    out[row.id] = entry;
  }));
  return out;
}

module.exports = { withRecordedClips, recordedClips, stemAsksForSound };
