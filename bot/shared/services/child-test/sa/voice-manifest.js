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
  // Either shape, or a chain of them (RULING #31a: carriers, then the item in its own language).
  const any = (x, role, ear) => {
    if (Array.isArray(x)) x.forEach((y) => any(y, role, ear));
    else if (x && x.lang) one(x, role, ear);
    else both(x, role);
  };
  for (const line of Object.values(bank.lines || {})) both(line, 'battery');
  // A rotating passage's other texts (RULING #39) are voiced like the task's own.
  const all = Object.values(bank.tasks || {}).flatMap((t) => [t, ...(t.variants || []).map((v) => v.task)]);
  for (const t of all) {
    const ear = EAR[(t.task || '').split('.')[1]];
    const sc = t.script || {};
    for (const [k, line] of Object.entries(sc)) {
      if (k === 'demo_item' || k === 'demo_image') continue;
      any(line, 'instruction', /_chain$/.test(k) ? ear : false);
    }
    for (const it of [...((t.tap && t.tap.items) || []), ...(t.practice || []), ...(t.practice_v2 || []), ...(sc.demo_item ? [sc.demo_item] : [])]) {
      if (it.say) (it.say.lang ? one(it.say, 'item', ear) : both(it.say, 'item'));
      if (it.prompt) both(it.prompt, 'problem');
      if (it.feedback) for (const [k, line] of Object.entries(it.feedback)) any(line, 'feedback', /_chain$/.test(k) ? ear : false);
    }
    for (const q of (t.record && t.record.questions) || []) one(q.prompt, 'question');
    if (t.record && t.record.passage && t.record.passage.audio) one(t.record.passage, 'passage');
  }
  return [...byKey.values()].sort((a, b) => (a.key < b.key ? -1 : 1));
}

module.exports = { voiceManifest };
