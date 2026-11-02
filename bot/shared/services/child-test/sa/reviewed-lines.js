'use strict';

/**
 * The content reviewers' wording of Jugnu's lines (bot/shared/data/child-test/sa-lines-reviewed.v1.json), laid over the
 * built bank. The file holds only the lines a reviewer changed, in only the language they changed, as final text:
 *
 *   lines   { <battery line>: { en?, ur? } }                         bank.lines
 *   script  { <script line>: { en?, ur? } }                          every task's script that has the line
 *   tasks   { <task id>: { <script line> | practice_frame: { en?, ur? } } }   that task in every form; practice_frame is
 *           the words Jugnu says before a practice item's answer ("The name of this letter is:")
 *   replace [{ lang, from, to }]                                     applied last: the line changes wherever that exact
 *           text is said (the reviewers' "every line" table: one row = one text, every place it plays)
 *
 * A changed text gets the clip key its words hash to (sa/v1/<lang>/<sha1(lang|text)[0,12]>.mp3, the builder's rule), so
 * the screen and the voice change together and an unchanged language keeps its key. No file, nothing changes.
 */
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const FILE = path.join(__dirname, '..', '..', '..', 'data', 'child-test', 'sa-lines-reviewed.v1.json');
const audioKey = (lang, text) => `sa/v1/${lang}/${crypto.createHash('sha1').update(`${lang}|${text}`).digest('hex').slice(0, 12)}.mp3`;

function loadReviewed(file = FILE) {
  return fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : null;
}

/** A spoken line ({ en, ur, audio{en,ur} }) with the reviewed languages swapped in; the same object when nothing changes. */
function relay(line, change) {
  if (!line || !change || !line.audio) return line;
  const out = { ...line, audio: { ...line.audio } };
  let changed = false;
  for (const lang of ['en', 'ur']) {
    if (typeof change[lang] !== 'string' || change[lang] === line[lang]) continue;
    out[lang] = change[lang];
    out.audio[lang] = audioKey(lang, change[lang]);
    changed = true;
  }
  return changed ? out : line;
}

const isFrame = (m) => m && typeof m.en === 'string' && typeof m.ur === 'string' && m.audio && !/^\d+$/.test(m.en.trim());

function relayTask(task, script, own) {
  let t = task;
  const sc = { ...(t.script || {}) };
  let touched = false;
  for (const [k, change] of Object.entries({ ...script, ...own })) {
    if (k === 'practice_frame' || !sc[k]) continue;
    const next = relay(sc[k], change);
    if (next !== sc[k]) { sc[k] = next; touched = true; }
  }
  if (touched) t = { ...t, script: sc };
  const frame = own && own.practice_frame;
  if (frame) {
    for (const field of ['practice', 'practice_v2']) {
      if (!Array.isArray(t[field])) continue;
      t = { ...t, [field]: t[field].map((p) => (Array.isArray(p.model) ? { ...p, model: p.model.map((m) => (isFrame(m) ? relay(m, frame) : m)) } : p)) };
    }
  }
  return t;
}

/**
 * replace [{ lang, from, to }]: a line changes wherever that exact text is said (battery lines, every script line or list
 * of lines, practice frames), in that language. A practice answer is never a frame, so it never changes.
 */
function replaceSpoken(bank, list) {
  if (!Array.isArray(list) || !list.length) return bank;
  const by = { en: new Map(), ur: new Map() };
  for (const r of list) if (by[r.lang] && typeof r.from === 'string' && typeof r.to === 'string') by[r.lang].set(r.from, r.to);
  const one = (l) => (l && l.audio ? relay(l, { en: by.en.get(l.en), ur: by.ur.get(l.ur) }) : l);
  const lines = Object.fromEntries(Object.entries(bank.lines || {}).map(([k, l]) => [k, one(l)]));
  const tasks = {};
  for (const [id, t] of Object.entries(bank.tasks || {})) {
    const script = t.script && Object.fromEntries(Object.entries(t.script).map(([k, v]) => [k, Array.isArray(v) ? v.map(one) : one(v)]));
    let u = script ? { ...t, script } : t;
    for (const field of ['practice', 'practice_v2']) {
      if (!Array.isArray(u[field])) continue;
      u = { ...u, [field]: u[field].map((p) => (Array.isArray(p.model) ? { ...p, model: p.model.map((m) => (isFrame(m) ? one(m) : m)) } : p)) };
    }
    tasks[id] = u;
  }
  return { ...bank, lines, tasks };
}

/** The bank with the reviewed lines in place. Pure: the bank passed in is not changed. */
function applyReviewed(bank, reviewed) {
  if (!bank || !reviewed) return bank;
  const lines = { ...(bank.lines || {}) };
  for (const [k, change] of Object.entries(reviewed.lines || {})) if (lines[k]) lines[k] = relay(lines[k], change);
  const tasks = {};
  for (const [id, t] of Object.entries(bank.tasks || {})) {
    tasks[id] = relayTask(t, reviewed.script || {}, (reviewed.tasks || {})[id.split('/').pop()] || {});
  }
  return replaceSpoken({ ...bank, lines, tasks }, reviewed.replace);
}

module.exports = { FILE, applyReviewed, loadReviewed, audioKey };
