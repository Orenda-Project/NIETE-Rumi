'use strict';

/**
 * Every line Jugnu speaks in the SA bank, once: { key, lang, text, role, ear_check }. `key` is the clip's path
 * under the served SA audio base (the same key the bank carries), so one clip serves every task that says the
 * same words. `ear_check` marks the clips a person must hear before they are served: isolated letter names, made-up
 * words and single words, which a text-to-speech voice may say wrongly.
 */

const EAR = { letters: true, nonwords: true, words: true, letter_sounds: true, initial_sound: true };

function voiceManifest(bank) {
  const byKey = new Map();
  const add = (lang, text, key, role, ear = false) => {
    if (!text || !key) return;
    const row = byKey.get(key);
    if (row) { if (ear) row.ear_check = true; return; }
    byKey.set(key, { key, lang, text, role, ear_check: !!ear });
  };
  // { en, ur, audio{en,ur} } — a line or words in either language.
  const both = (x, role) => { if (x && x.audio) for (const lang of ['en', 'ur']) add(lang, x[lang], x.audio[lang], role); };
  // { text, lang, audio } — words in one language.
  const one = (x, role, ear) => { if (x && x.audio) add(x.lang, x.text, x.audio, role, ear); };
  for (const line of Object.values(bank.lines || {})) both(line, 'battery');
  for (const t of Object.values(bank.tasks || {})) {
    for (const line of Object.values(t.script || {}).flat()) both(line, 'instruction');
    const ear = EAR[(t.task || '').split('.')[1]];
    for (const it of [...((t.tap && t.tap.items) || []), ...(t.practice || [])]) {
      if (it.say) (it.say.lang ? one(it.say, 'item', ear) : both(it.say, 'item'));
      if (it.prompt) both(it.prompt, 'problem');
      if (it.feedback) for (const line of Object.values(it.feedback)) both(line, 'feedback');
    }
    for (const q of (t.record && t.record.questions) || []) one(q.prompt, 'question');
    if (t.record && t.record.passage && t.record.passage.audio) one(t.record.passage, 'passage');
  }
  return [...byKey.values()].sort((a, b) => (a.key < b.key ? -1 : 1));
}

module.exports = { voiceManifest };
