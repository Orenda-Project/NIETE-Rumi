'use strict';
/**
 * Child test (bd-s1oo0.5) — first sounds and made-up words.
 *
 * First sounds are marked by the coach; the AI verdict is a hint only (the
 * assembler caps its confidence). Made-up words: Gemini on the clip; on English
 * SpeechAce also scores the list (quality < 40 = wrong) and the two are combined
 * — agreement raises the confidence, disagreement lowers it.
 */

const prompts = require('./prompts');
const { modelFor } = require('./models');
const { chatJSON } = require('./llm');
const { cutClip, cleanup } = require('./media');
const speechace = require('./speechace');

const V = new Set(['correct', 'wrong', 'none']);

async function scorePhonics({ lang, spec, file, windows, calls }) {
  const firstSounds = lang === 'urdu' ? (spec.first_sounds || []) : [];
  const nonwords = spec.nonwords || [];
  const start = (windows.first_sounds || windows.nonwords || {}).start;
  const end = (windows.nonwords || windows.first_sounds || {}).end;
  if (start == null || end == null) return { ok: false, error: 'no_window' };
  const model = modelFor('phonics');
  const files = [];
  try {
    const clip = await cutClip(file, start - 0.5, end + 0.5, 'mp3'); files.push(clip.path);
    const r = await chatJSON({ model, job: 'child_test.phonics', prompt: prompts.PHONICS({ lang, firstSounds, nonwords }), audio: { data: clip.base64, format: 'mp3' } });
    calls.push({ job: 'phonics', model, cost: r.cost, seconds: r.seconds, error: r.error });
    if (!r.json) return { ok: false, error: r.error || 'no_json' };
    const rows = (list) => (list || []).filter((x) => x && x.id && V.has(x.verdict))
      .map((x) => ({ id: x.id, verdict: x.verdict, heard: String(x.heard || ''), confidence: Number(x.confidence) || 0.5 }));
    const fs = rows(r.json.first_sounds);
    let nw = rows(r.json.nonwords).map((x) => ({ ...x, confidence: Math.min(x.confidence, 0.6) }));

    if (lang === 'english' && nonwords.length && windows.nonwords && speechace.configured()) {
      const w = windows.nonwords;
      const wav = await cutClip(file, w.start, Math.min(w.end, w.start + 30), 'wav'); files.push(wav.path);
      const sa = await speechace.scoreText(wav.path, nonwords.map((n) => n.text).join(' '), { seconds: Math.min(30, w.end - w.start) });
      calls.push({ job: 'speechace_nonwords', model: 'speechace:text/v9', cost: sa.cost, seconds: sa.seconds, error: sa.error });
      if (!sa.error && sa.words.length) {
        nw = nw.map((x) => {
          const i = nonwords.findIndex((n) => n.id === x.id);
          const s = sa.words[i];
          if (!s || x.verdict === 'none') return x;
          const saVerdict = s.wrong ? 'wrong' : 'correct';
          return { ...x, confidence: saVerdict === x.verdict ? 0.75 : 0.35 };
        });
      }
    }
    return { ok: true, part: { first_sounds: fs, nonwords: nw }, modelVersion: model };
  } catch (e) {
    return { ok: false, error: String(e && e.message || e).slice(0, 200) };
  } finally { cleanup(files); }
}

module.exports = { scorePhonics };
