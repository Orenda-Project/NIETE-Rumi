'use strict';
// Part of assessment-generation.service.js (see its header); split for the 300-line limit, bd-5jmnfj.37.
const Reader = require('../fde-reader');
const { applyLayout, takenNote, firstAskNote, verseLines, scopeLessons, oneStory, STORY_ITEMS } = require('../fde-layout');
const { logToFile } = require('../../../utils/logger');
const { normaliseAnswers } = require('./answers-generate');
const { SST_Q1 } = require('./held-terms');
const { stripImageKeys } = require('./marks-answers');
const { _mergeSections, _topUp } = require('./poem-sections');
const { READER_TOP_UPS, READ_SLOT, _askReader, _dropItems, _grammarUsedUp, _grammarUsedUpNote, _readerId, religiousFilter } = require('./religious-reader');
const { _sectionMessages } = require('./section-calls');
const { _blankWordsStems, _reviewTextHits, _sumUsage } = require('./section-write');

async function _readerPass({ examJson, P, key, layoutScope, now, pattern, built, writeOne, system, model, ownModel, job, loaded, grade, subject, requestId }) {
  const began = Date.now();
  const readUsages = [];
  const sectionUsages = [];
  // put_back stays 0: a reader-caught item never prints (a place it leaves fails the paper closed).
  const stats = { flagged: 0, replaced: 0, still_flagged: 0, put_back: 0, top_ups: 0 };
  // What became of each flag, written on the paper (`_layout.reader`) as well as the log line, so a
  // panel reads from exam_json which items printed over a flag. The renderers never read it.
  const items = [];
  const record = (f, outcome) => items.push({ label: f.item, by: f.by, reason: f.reason, outcome });
  const lay = (exam) => applyLayout(exam, P, layoutScope, { now, presetId: pattern, reasked: true });
  // The record keeps its items on every path, an error's included: a failed paper still names them.
  const done = (exam, laid, error = null) => {
    logToFile('[assessment] reader pass', {
      requestId, subject: key, ...stats, ms: Date.now() - began, tokens: _sumUsage(readUsages).total_tokens || 0, ...(error ? { error } : {}),
    });
    if (exam && exam._layout) exam._layout.reader = { ...stats, items, ...(error ? { error } : {}) };
    return { examJson: exam, laid, usages: readUsages.concat(sectionUsages) };
  };
  // The book pages ride along, so the reader is handed the pairs whose answers stand side by side in them.
  const ask = (exam, only = null) => _askReader({ examJson: exam, P, only, pages: loaded && loaded.content, model, ownModel, job, usages: readUsages });
  // A flag with its item and, when another Q1 item gives it away, that partner: the top-up is told both.
  const withItems = (read) => read.flags.map((f) => ({ ...f, q: read.labels.get(f.item), partner: read.labels.get(f.by) || null }));
  const idsOf = (list) => new Set(list.map((h) => _readerId(h.q)));

  let first;
  try {
    first = await ask(examJson);
  } catch (err) {
    return done(examJson, null, `read: ${err.message}`);
  }
  if (!first.flags.length) return done(examJson, null);
  stats.flagged = first.flags.length;
  const held = withItems(first);
  held.forEach((h) => record(h, 'replaced'));
  // Every item a read has caught: none of them prints, and every top-up is told all of them.
  let taken = held;
  let laid = lay(_dropItems(examJson, READ_SLOT, idsOf(held)));
  const short = (l) => l.shortfall.filter((f) => f.slot === READ_SLOT);

  try {
    const b = built.find((x) => x.section.slots.some((s) => s.slot === READ_SLOT));
    for (let round = 0; round < READER_TOP_UPS && short(laid).length; round += 1) {
      const kept = laid;
      const shortfall = short(kept);
      // Ask twice what is missing (plus the note's spares): on a narrow scope the layout holds most of a
      // top-up's items (5 asked, 4 held on a local lessons 6-7 paper), and the extras never print.
      const ask2 = shortfall.map((f) => ({ ...f, missing: f.missing * 2 }));
      // The one more top-up is told grammar is used up: the first one's place was
      // left by a grammar concept asked again, which never comes back.
      const usedUp = round > 0 && _grammarUsedUp(P, layoutScope, kept) ? _grammarUsedUpNote(P, layoutScope) : null;
      const note = [takenNote(P, b.section, kept.examJson, { topUp: true, shortfall: ask2 }), Reader.readerNote(taken), usedUp]
        .filter(Boolean).join('\n\n');
      logToFile('[assessment] section re-asked', { requestId, pattern, section: b.section.id, shortfall, reader: taken.map(({ q, partner, ...f }) => f) });
      stats.top_ups += 1;
      const second = await writeOne({ ...b, messages: _sectionMessages({ system, user: `${b.user}\n\n${note}`, pageContent: b.pageContent, model }) });
      sectionUsages.push(...second.usages);
      // A replacement carrying text the paper refuses to print would fail the paper at render.
      if (_reviewTextHits([{ id: b.section.id, tree: second.tree }]).size) return done(kept.examJson, kept, 'top-up: refused text');
      stripImageKeys(second.tree);
      normaliseAnswers(second.tree);
      // Only new Q1 items: a caught item written again is not a replacement.
      const fresh = _dropItems(second.tree, READ_SLOT, idsOf(taken));
      let next = lay(_topUp(kept.examJson, fresh, new Set([READ_SLOT])));
      _blankWordsStems(next.examJson, P, key);
      if ((await religiousFilter(next.examJson, P, { grade, subject, allowedText: loaded.content, requestId })).length) next = lay(next.examJson);

      const keptIds = new Set(Reader.itemsOf(kept.examJson, READ_SLOT).map(_readerId));
      const replacements = Reader.itemsOf(next.examJson, READ_SLOT).filter((q) => !keptIds.has(_readerId(q)));
      let still = [];
      if (replacements.length) {
        try {
          still = withItems(await ask(next.examJson, replacements));
          stats.rechecked = true;
        } catch (err) {
          stats.rechecked = false;
          logToFile('[assessment] reader re-check failed, replacements kept', { requestId, error: err.message });
        }
      }
      stats.still_flagged += still.length;
      stats.replaced += replacements.length - still.length;
      still.forEach((h) => record(h, 'taken_off'));
      taken = taken.concat(still);
      laid = still.length ? lay(_dropItems(next.examJson, READ_SLOT, idsOf(still))) : next;
    }
    // Still short after the top-ups: the paper fails closed (PATTERN_SHORT_SLOT, with this record),
    // never printing a caught item to fill the place.
    if (laid.shortfall.length) return done(laid.examJson, laid, 'the paper would be short');
    return done(laid.examJson, laid);
  } catch (err) {
    return done(laid.examJson, laid, `top-up: ${err.message}`);
  }
}

// ── The reader pass (Social Studies) ───────────────────────────────────
//
// The same read for T6-A: the reader judges the Q5, Q6 and Q7 items (a duplicate, a whole answer
// Section A prints, a point set another C/D item's answer contains). Every flagged item is taken off.
// A flagged D item leaves a place that Section D fills in ONE top-up (told what was taken off, asked
// twice what is missing plus spares), the paper is laid out again and the reader checks the
// replacements only; one still flagged is taken off too. A flagged Q5 is taken off with no re-ask:
// Q5 offers more than the child answers. Nothing taken off comes back: a choice slot prints fewer
// items (applyLayout), and a paper the pass would leave short fails closed (PATTERN_SHORT_SLOT, with
// this record on it), never printing a caught item to fill the place. A read that fails prints the
// paper as it was: no caught item is known.
// A D slot the replacements alone could not fill also offers its first-ask spares (`source`: what the
// model wrote, before the layout): the items the layout finds new but had no room for. They are read
// in the same re-check as the replacements, and one fills a place only when the slot is short without
// it; a spare the re-check flags never prints either.
const SST_D_SLOTS = ['social_studies.D.Q6', 'social_studies.D.Q7'];

/**
 * Social Studies: the first-ask spares a D slot could take when the reader's re-check might leave it
 * short. A slot is at risk when it is short with every replacement taken off; its spares are the items
 * of `source` (the model's replies) that a layout of the paper, without the replacements, places in
 * it: new against everything the layout holds against, and not an item the reader caught. Laid out
 * (their slot, marks and lines set). None when no slot is at risk.
 */
function _sstSpares({ exam, source, replacements, caught, lay }) {
  if (!source) return [];
  const without = replacements.reduce((e, q) => _dropItems(e, q.slot, new Set([_readerId(q)])), exam);
  const risk = new Set(lay(without).shortfall.map((f) => f.slot).filter((slot) => SST_D_SLOTS.includes(slot)));
  if (!risk.size) return [];
  const onPaper = new Set(SST_D_SLOTS.flatMap((slot) => Reader.itemsOf(exam, slot).map(_readerId)));
  const caughtIds = new Set(caught.map((h) => _readerId(h.q)));
  const trial = lay(_topUp(without, source, risk)).examJson;
  return [...risk].flatMap((slot) => Reader.itemsOf(trial, slot))
    .filter((q) => !onPaper.has(_readerId(q)) && !caughtIds.has(_readerId(q)));
}

// Social Studies: how many Q1 items a C or D stem gives away on a laid-out paper (the layout's
// key_in_stem and asked_in_c holds).
const _q1Given = (laid) => (laid.held || []).filter((h) => h.slot === SST_Q1 && (h.rule === 'key_in_stem' || h.rule === 'asked_in_c')).length;

/**
 * Social Studies: the items of a Section D top-up (`fresh`, a reply tree) that would hold a Q1 item the
 * paper (`exam`) prints now, as { slot, q }. A top-up that leaves Q1 whole has none. Each new item the
 * layout places is tried without it; one whose absence gives a Q1 item back is a giver, and the trial
 * goes on without it, since the next item in the reply then takes its place.
 */
function _q1GiversOf(exam, fresh, lay, keptIds) {
  const slots = new Set(SST_D_SLOTS);
  const out = [];
  let tree = fresh;
  for (let round = 0; round < 8; round += 1) {
    const laid = lay(_topUp(exam, tree, slots));
    if (!laid.shortfall.some((f) => f.slot === SST_Q1)) break;
    const n = _q1Given(laid);
    const placed = SST_D_SLOTS.flatMap((slot) => Reader.itemsOf(laid.examJson, slot)).filter((q) => !keptIds.has(_readerId(q)));
    const giver = placed.find((q) => _q1Given(lay(_topUp(exam, _dropItems(tree, q.slot, new Set([_readerId(q)])), slots))) < n);
    if (!giver) break;
    out.push({ slot: giver.slot, q: giver });
    tree = _dropItems(tree, giver.slot, new Set([_readerId(giver)]));
  }
  return out;
}

// The paper with the given laid-out items added at the end of their slots' lists.
function _withItems(examJson, list) {
  const out = JSON.parse(JSON.stringify(examJson));
  for (const q of list) {
    const slot = q.slot;
    const lists = Object.values(out.unseen || {}).flatMap((types) => Object.values(types || {})).filter(Array.isArray);
    const home = lists.find((l) => l.some((x) => x && x.slot === slot));
    if (home) home.push(JSON.parse(JSON.stringify(q)));
    else out.unseen = _mergeSections([out, { unseen: { _spares: { [slot]: [JSON.parse(JSON.stringify(q))] } } }]).unseen;
  }
  return out;
}
const _labelSlot = (label) => ({ Q5: 'social_studies.C.Q5', Q6: 'social_studies.D.Q6', Q7: 'social_studies.D.Q7' })[String(label).split('.')[0]];

module.exports = {
  SST_D_SLOTS, _labelSlot, _q1Given, _q1GiversOf, _readerPass, _sstSpares, _withItems,
};
