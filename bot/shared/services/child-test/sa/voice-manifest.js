'use strict';

/**
 * Every line Jugnu speaks in the SA batteries, once: { key, lang, text, role, ear_check }. `key` is the clip's path
 * under the served SA audio base (the same key the battery files carry), so one clip serves every battery that says the
 * same words. `ear_check` marks the clips a person must hear before they are served: isolated letter names, made-up
 * words and single words, which a text-to-speech voice may say wrongly.
 */

const EAR = { letters: true, nonwords: true, words: true };

function voiceManifest(batteries) {
  const byKey = new Map();
  const add = (lang, text, audio, role, ear = false) => {
    if (!text || !audio) return;
    const key = typeof audio === 'string' ? audio : audio[lang];
    if (!key) return;
    const row = byKey.get(key);
    if (row) { if (ear) row.ear_check = true; return; }
    byKey.set(key, { key, lang, text, role, ear_check: !!ear });
  };
  const both = (line, role) => { for (const lang of ['en', 'ur']) add(lang, line[lang], line.audio, role); };
  for (const b of batteries) {
    for (const line of Object.values(b.lines || {})) both(line, 'battery');
    for (const t of b.tasks) {
      for (const line of Object.values(t.script || {})) both(line, 'instruction');
      const kind = (t.id || '').split('.')[1];
      for (const it of [...(t.practice || []), ...(t.items || [])]) {
        if (it.say && it.prompt_audio) {
          if (typeof it.say === 'string') add(t.lang, it.say, it.prompt_audio, 'item', EAR[kind]);
          else for (const lang of ['en', 'ur']) add(lang, it.say[lang], it.prompt_audio, 'item');
        }
        if (it.prompt && it.prompt.audio) {
          if (typeof it.prompt.audio === 'string') add(it.prompt.lang, it.prompt.text, it.prompt.audio, 'question');
          else for (const lang of ['en', 'ur']) add(lang, it.prompt[lang], it.prompt.audio, 'problem');
        }
        (it.choice_audio || []).forEach((k, i) => add(t.lang, String(it.choices[i]), k, 'choice'));
        if (it.feedback) for (const line of Object.values(it.feedback)) both(line, 'feedback');
      }
      if (t.passage && t.passage.audio) add(t.passage.lang, t.passage.text, t.passage.audio, 'passage');
    }
  }
  return [...byKey.values()].sort((a, b) => (a.key < b.key ? -1 : 1));
}

module.exports = { voiceManifest };
