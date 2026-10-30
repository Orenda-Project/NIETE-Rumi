'use strict';
/**
 * A fill-in-the-blanks word box keeps at least one spare word (bd-5jmnfj.33.7.1, round 6). v36 G3 General
 * Knowledge Q3 kept 10 words for 10 blanks and G4 Science Q2 5 for 5 after six re-asks (fde-word-box flags it
 * and the re-ask asks for a spare): with no word left over the last blank is free. This is the deterministic
 * fallback after the re-ask. It authors nothing: the spare is a word the chapter text already uses, of the
 * same kind as the box's answers, and with no such word the box is left as it is and the note says so.
 *
 * Same kind: the answers' script (Arabic or Latin), one word, a length inside the answers' range (one letter
 * either side), never an answer, never a word already printed in the slot's sentences (so it is not a word
 * the blank's own sentence names), never a function word. Ranked by how often the chapter uses it, then by
 * where it first appears. The spare goes in the middle of the box, never last.
 *
 * Pure: exam JSON + pattern + book text in, `{examJson, notes}` out; the input is never mutated; never throws.
 */

const { itemsInOrder } = require('./fde-near-repeats');

const MARKS = /[ً-ٰٟۖ-ۭ]/g;
const bare = (s) => String(s == null ? '' : s).normalize('NFC').replace(MARKS, '').toLowerCase().replace(/\s+/g, ' ').trim();
const ARABIC = /[؀-ۿ]/;
const TOKEN = /[\p{L}\p{M}]+/gu;

// Words that carry grammar, not chapter content: a spare drawn from these would fit any blank or none sensibly.
const STOP_EN = new Set(('a an the and or but if then than that this these those there here is are was were be been being am '
  + 'do does did done have has had having it its it\'s he she they we you i me him her them us our your their his my mine '
  + 'of to in on at by for from with without into onto over under up down out off about as so too very not no yes can '
  + 'could will would shall should may might must also just only all any some many much more most less few each every '
  + 'what which who whom whose when where why how one two three other another such own same both either neither '
  + 'because while after before during again once let lets get gets got make makes made use used uses like').split(/\s+/));
const STOP_UR = new Set(('ہے ہیں تھا تھی تھے ہو ہوں ہوا ہوئی ہوئے ہوتا ہوتی ہوتے ہونا گا گی گے کا کی کے کو میں سے پر تک '
  + 'اور یا لیکن مگر پھر بھی تو نہ نہیں جو جس جن جب کہ کیا کیوں کون کہاں کیسے یہ وہ یہاں وہاں اس ان اسے انھیں انہیں '
  + 'ہم ہمیں ہمارا ہماری ہمارے آپ تم میں میرا میری میرے اپنا اپنی اپنے ایک دو سب کچھ بہت زیادہ کم ساتھ لیے لئے والا '
  + 'والی والے کر کرنا کرتا کرتی کرتے کریں کرے کیا کی گیا گئی گئے جاتا جاتی جاتے جانا رہا رہی رہے سکتا سکتی سکتے '
  + 'چاہیے چاہئے دیا دی دیے لیا لی لیے ہی اگر جیسے ایسا ایسی ایسے کسی کوئی بعد پہلے').split(/\s+/));

const isFill = (q) => q && q.slot && !Array.isArray(q.options);
const boxOf = (q) => (Array.isArray(q.words) ? q.words.filter((w) => typeof w === 'string' && bare(w)) : []);

/**
 * Book words that could stand as a spare for a box whose answers are `answers`, best first.
 * `sentences` are the slot's printed sentences; `book` is the chapter text.
 */
function spareCandidates(answers, sentences, book) {
  const ans = (answers || []).map((a) => String(a == null ? '' : a).trim()).filter(Boolean);
  const single = ans.filter((a) => !/\s/.test(a));
  if (!single.length || !book) return [];
  const urdu = single.some((a) => ARABIC.test(a));
  const lens = single.map((a) => bare(a).length);
  const lo = Math.min(...lens) - 1;
  const hi = Math.max(...lens) + 1;
  const lower = !urdu && single.every((a) => a[0] === a[0].toLowerCase());
  const taken = new Set(ans.map(bare));
  (sentences || []).forEach((s) => (String(s || '').match(TOKEN) || []).forEach((t) => taken.add(bare(t))));
  const stop = urdu ? STOP_UR : STOP_EN;
  const seen = new Map(); // bare → { word, count, first }
  (String(book).match(TOKEN) || []).forEach((tok, i) => {
    const b = bare(tok);
    if (ARABIC.test(tok) !== urdu || /\d/.test(tok)) return;
    if (b.length < lo || b.length > hi || b.length < (urdu ? 3 : 4)) return;
    if (taken.has(b) || stop.has(b)) return;
    const row = seen.get(b) || { word: lower ? tok.toLowerCase() : tok.replace(MARKS, ''), count: 0, first: i };
    row.count += 1;
    seen.set(b, row);
  });
  return [...seen.values()].sort((a, b) => b.count - a.count || a.first - b.first).map((r) => r.word);
}

/** The exam with one book word added to every fill box that has no spare, and a note per box handled. */
function addSpareWord(examJson, P, book) {
  if (!examJson || !P || P.g5_rules !== false) return { examJson: examJson || null, notes: [] };
  const out = JSON.parse(JSON.stringify(examJson));
  const bySlot = new Map();
  itemsInOrder(out).filter(isFill).forEach((q) => {
    if (!bySlot.has(q.slot)) bySlot.set(q.slot, []);
    bySlot.get(q.slot).push(q);
  });
  const notes = [];
  bySlot.forEach((items, slot) => {
    const carrier = items.find((q) => boxOf(q).length);
    if (!carrier) return;
    const box = boxOf(carrier);
    const answers = items.map((q) => (typeof q.answer === 'string' ? q.answer : ''));
    const answerSet = new Set(answers.map(bare));
    if (box.some((w) => !answerSet.has(bare(w)))) return; // a spare is already there
    const spare = spareCandidates(answers, items.map((q) => q.question), book)[0] || null;
    if (!spare) { notes.push({ slot, spare: null, from: 'none' }); return; }
    const at = Math.max(0, Math.min(box.length - 1, Math.floor(box.length / 2)));
    carrier.words = [...box.slice(0, at), spare, ...box.slice(at)];
    notes.push({ slot, spare, from: 'book' });
  });
  return { examJson: out, notes };
}

module.exports = { addSpareWord, spareCandidates };
