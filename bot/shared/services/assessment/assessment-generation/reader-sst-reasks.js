'use strict';
// Part of assessment-generation.service.js (see its header); split for the 300-line limit, bd-5jmnfj.37.
const Reader = require('../fde-reader');
const { applyLayout, takenNote, firstAskNote, verseLines, scopeLessons, oneStory, STORY_ITEMS } = require('../fde-layout');
const { logToFile } = require('../../../utils/logger');
const { normaliseAnswers } = require('./answers-generate');
const { stripImageKeys } = require('./marks-answers');
const { _dropProseVerses, _topUp } = require('./poem-sections');
const { SST_D_SLOTS, _labelSlot, _q1Given, _q1GiversOf, _sstSpares, _withItems } = require('./reader-pass');
const { READ_SLOT, _askReader, _dropItems, _grammarUsedUpNote, _readerId, religiousFilter } = require('./religious-reader');
const { _sectionMessages } = require('./section-calls');
const { _blankWordsStems, _reviewTextHits, _sumUsage } = require('./section-write');

async function _readerPassSst({ examJson, source = null, P, key, layoutScope, now, pattern, built, writeOne, system, model, ownModel, job, loaded, grade, subject, requestId }) {
  const began = Date.now();
  const readUsages = [];
  const sectionUsages = [];
  const stats = { flagged: 0, replaced: 0, still_flagged: 0, taken_off: 0, spares_read: 0, spares: 0 };
  const items = [];
  const record = (f, outcome) => items.push({ label: f.item, by: f.by, reason: f.reason, outcome });
  const lay = (exam) => applyLayout(exam, P, layoutScope, { now, presetId: pattern, reasked: true, ...(loaded ? { book: loaded.content } : {}) });
  const done = (exam, laid, error = null) => {
    logToFile('[assessment] reader pass', {
      requestId, subject: key, ...stats, ms: Date.now() - began, tokens: _sumUsage(readUsages).total_tokens || 0, ...(error ? { error } : {}),
    });
    // The record keeps its items on every path, an error's included: a refused paper still names them.
    if (exam && exam._layout) exam._layout.reader = { ...stats, items, ...(error ? { error } : {}) };
    return { examJson: exam, laid, usages: readUsages.concat(sectionUsages) };
  };
  const ask = (exam, only = null) => _askReader({ examJson: exam, P, only, model, ownModel, job, usages: readUsages });
  const without = (exam, list) => list.reduce((e, h) => _dropItems(e, h.slot, new Set([_readerId(h.q)])), exam);
  const count = (exam, slot) => Reader.itemsOf(exam, slot).length;

  let first;
  try {
    first = await ask(examJson);
  } catch (err) {
    return done(examJson, null, `read: ${err.message}`);
  }
  if (!first.flags.length) return done(examJson, null);
  stats.flagged = first.flags.length;
  const held = first.flags.map((f) => ({ ...f, q: first.labels.get(f.item), slot: _labelSlot(f.item) }));

  const dHeld = held.filter((h) => SST_D_SLOTS.includes(h.slot));
  // From here on no caught item prints: every exit returns the paper with them taken off, and one the
  // pass leaves short fails closed in the engine (PATTERN_SHORT_SLOT) with this record attached.
  let laid = lay(without(examJson, held));
  let exam = laid.examJson;
  let still = [];
  let replacements = [];
  const settle = (error = null) => {
    stats.still_flagged = still.length;
    stats.replaced = error ? 0 : replacements.length - still.length;
    stats.taken_off = held.length + still.length;
    held.forEach((h) => record(h, !error && SST_D_SLOTS.includes(h.slot) ? 'replaced' : 'taken_off'));
    still.forEach((h) => record(h, 'taken_off'));
    return done(exam, laid, error);
  };
  try {
    if (dHeld.length) {
      const b = built.find((x) => x.section.slots.some((s) => s.slot === SST_D_SLOTS[0]));
      const missing = b.section.slots.map((s) => ({ slot: s.slot, missing: s.generate - count(exam, s.slot) })).filter((f) => f.missing > 0);
      // Asked twice what is missing (and the note's spares): the layout holds some of a top-up's items too.
      const ask2 = missing.map((f) => ({ ...f, missing: f.missing * 2 }));
      const note = [takenNote(P, b.section, exam, { topUp: true, shortfall: ask2, held: laid.held }), Reader.readerNote(dHeld, first.labels, P)]
        .filter(Boolean).join('\n\n');
      logToFile('[assessment] section re-asked', { requestId, pattern, section: b.section.id, shortfall: missing, reader: dHeld.map(({ q, ...f }) => f) });
      const second = await writeOne({ ...b, messages: _sectionMessages({ system, user: `${b.user}\n\n${note}`, pageContent: b.pageContent, model }) });
      sectionUsages.push(...second.usages);
      if (_reviewTextHits([{ id: b.section.id, tree: second.tree }]).size) return settle('top-up: refused text');
      stripImageKeys(second.tree);
      normaliseAnswers(second.tree);
      // Only new items: an item taken off and written again is not a replacement.
      let fresh = without(second.tree, dHeld);
      const keptIds = new Set(SST_D_SLOTS.flatMap((slot) => Reader.itemsOf(exam, slot).map(_readerId)));
      // A replacement whose stem gives a Q1 item away (its key printed on its topic) holds that Q1 item,
      // and Section A has no top-up after the reader: the paper would fail for a D item. That
      // replacement is left out instead, before the re-check, so the Q1 item prints and every D item
      // that prints is one the reader reads.
      const gave = _q1GiversOf(exam, fresh, lay, keptIds);
      if (gave.length) {
        fresh = without(fresh, gave);
        stats.gives_q1 = gave.length;
      }
      laid = lay(_topUp(exam, fresh, new Set(SST_D_SLOTS)));
      exam = laid.examJson;
      _blankWordsStems(exam, P, key);
      if ((await religiousFilter(exam, P, { grade, subject, allowedText: loaded.content, requestId })).length) {
        laid = lay(exam);
        exam = laid.examJson;
      }
      replacements = SST_D_SLOTS.flatMap((slot) => Reader.itemsOf(exam, slot)).filter((q) => !keptIds.has(_readerId(q)));
      const replacedIds = new Set(replacements.map(_readerId));
      const spares = _sstSpares({ exam, source, replacements, caught: held, lay });
      let spareFlags = [];
      if (replacements.length || spares.length) {
        // The paper as the re-check reads it: the replacements in place, the spares after them.
        const readExam = _withItems(exam, spares);
        const ids = new Set([...replacedIds, ...spares.map(_readerId)]);
        const judged = SST_D_SLOTS.flatMap((slot) => Reader.itemsOf(readExam, slot)).filter((q) => ids.has(_readerId(q)));
        stats.spares_read = spares.length;
        try {
          const again = await ask(readExam, judged);
          const flags = again.flags.map((f) => ({ ...f, q: again.labels.get(f.item), slot: _labelSlot(f.item) }));
          still = flags.filter((h) => replacedIds.has(_readerId(h.q)));
          spareFlags = flags.filter((h) => !replacedIds.has(_readerId(h.q)));
          stats.rechecked = true;
        } catch (err) {
          stats.rechecked = false;
          // An unread spare is never offered: only the replacements are kept, as before.
          spareFlags = spares.map((q) => ({ q, slot: q.slot }));
          logToFile('[assessment] reader re-check failed, replacements kept', { requestId, error: err.message });
        }
      }
      if (still.length) {
        laid = lay(without(exam, still));
        exam = laid.examJson;
      }
      const flaggedSpares = new Set(spareFlags.map((h) => _readerId(h.q)));
      // A spare that would give a Q1 item away is never offered either. Read only when D is short: each spare
      // costs a layout, and a D that is whole takes none.
      const dShort = laid.shortfall.some((f) => SST_D_SLOTS.includes(f.slot));
      const q1Given = dShort ? _q1Given(lay(exam)) : 0;
      const clean = dShort ? spares.filter((q) => !flaggedSpares.has(_readerId(q)) && _q1Given(lay(_withItems(exam, [q]))) <= q1Given) : [];
      if (clean.length && dShort) {
        const before = new Set(SST_D_SLOTS.flatMap((slot) => Reader.itemsOf(exam, slot).map(_readerId)));
        laid = lay(_withItems(exam, clean));
        exam = laid.examJson;
        _blankWordsStems(exam, P, key);
        if ((await religiousFilter(exam, P, { grade, subject, allowedText: loaded.content, requestId })).length) {
          laid = lay(exam);
          exam = laid.examJson;
        }
        // Nothing the reader caught comes back as a spare, whatever form the model wrote it in.
        const gone = [...held, ...still, ...spareFlags];
        if (gone.some((h) => SST_D_SLOTS.some((slot) => Reader.itemsOf(exam, slot).some((q) => _readerId(q) === _readerId(h.q))))) {
          laid = lay(without(exam, gone.map((h) => ({ ...h, slot: h.slot || h.q.slot }))));
          exam = laid.examJson;
        }
        stats.spares = SST_D_SLOTS.flatMap((slot) => Reader.itemsOf(exam, slot)).filter((q) => !before.has(_readerId(q))).length;
      }
    }
    return settle(laid.shortfall.length ? 'the paper would be short' : null);
  } catch (err) {
    return settle(`top-up: ${err.message}`);
  }
}

/**
 * Urdu: the places the lessons 1–3 filter emptied are asked again ONCE, for exactly what each slot
 * lacks. The filter matches any run of 24 characters only the held lessons print, and an everyday
 * phrase in a model answer can be one («… کی عادت اپنانی چاہیے۔»); one such run used to fail the whole
 * paper, since the slot was never refilled. The re-ask is told the runs that matched, and the filter
 * then reads the paper again exactly as strictly: a second quote leaves the slot short and the paper
 * fails as it always has. A section call that fails, or carries text the paper refuses, leaves it short too.
 */
async function _reaskQuoted({ examJson, laid, quotes, P, key, layoutScope, now, pattern, built, writeOne, system, model, loaded, grade, subject, requestId, versesRef }) {
  const usages = [];
  const short = laid.shortfall.filter((f) => quotes.some((x) => x.slot === f.slot));
  if (!short.length) return { examJson, laid, usages };
  const lay = (exam) => applyLayout(exam, P, layoutScope, { now, presetId: pattern, reasked: true });
  const asked = built.filter((b) => b.section.slots.some((s) => short.some((f) => f.slot === s.slot)));
  const replies = await Promise.all(asked.map(async (b) => {
    const mine = short.filter((f) => b.section.slots.some((s) => s.slot === f.slot));
    const label = (id) => { const slot = b.section.slots.find((s) => s.slot === id); return (slot && slot.label_en) || id.split('.').pop(); };
    const runs = [...new Set(quotes.filter((x) => mine.some((f) => f.slot === x.slot)).map((x) => x.match))];
    // Section A's own top-up note names what Q1 keeps (and its spares), so a refill is not a twin of a kept item.
    const kept = takenNote(P, b.section, examJson, { topUp: true, shortfall: mine });
    const note = 'This paper cannot print what you wrote for '
      + `${mine.map((f) => label(f.slot)).join(', ')}: it repeats words from a lesson the paper must never quote. `
      + `Never write these words, or any longer run that holds them, anywhere in an item, its answer or its scheme:\n${runs.map((r) => `- «${r}»`).join('\n')}\n`
      + (kept || mine.map((f) => `${label(f.slot)} needs ${f.missing} more. Write ${f.missing} new item${f.missing === 1 ? '' : 's'} for it, in your own everyday words.`).join('\n'));
    logToFile('[assessment] section re-asked', { requestId, pattern, section: b.section.id, shortfall: mine, quoted: runs });
    try {
      const second = await writeOne({ ...b, messages: _sectionMessages({ system, user: `${b.user}\n\n${note}`, pageContent: b.pageContent, model }) });
      usages.push(...second.usages);
      if (_reviewTextHits([{ id: b.section.id, tree: second.tree }]).size) return null;
      stripImageKeys(second.tree);
      normaliseAnswers(second.tree);
      _dropProseVerses(second.tree, versesRef, requestId);
      return { slots: new Set(mine.map((f) => f.slot)), tree: second.tree };
    } catch (err) {
      logToFile('[assessment] held quote re-ask failed', { requestId, section: b.section.id, error: err.message });
      return null;
    }
  }));
  let exam = examJson;
  for (const r of replies) if (r) exam = _topUp(exam, r.tree, r.slots);
  let next = lay(exam);
  _blankWordsStems(next.examJson, P, key);
  const again = await religiousFilter(next.examJson, P, { grade, subject, allowedText: loaded.content, requestId });
  if (again.length) next = lay(next.examJson);
  logToFile('[assessment] held quote re-asked', {
    requestId, slots: short.map((f) => f.slot), refilled: !next.shortfall.some((f) => short.some((x) => x.slot === f.slot)), held_again: again.length,
  });
  return { examJson: next.examJson, laid: next, usages };
}
async function _topUpGrammarUsedUp({ examJson, laid, P, key, layoutScope, now, pattern, built, writeOne, system, model, loaded, grade, subject, requestId, versesRef }) {
  const usages = [];
  const lay = (exam) => applyLayout(exam, P, layoutScope, { now, presetId: pattern, reasked: true });
  const b = built.find((x) => x.section.slots.some((s) => s.slot === READ_SLOT));
  const shortfall = laid.shortfall.filter((f) => f.slot === READ_SLOT);
  const note = [takenNote(P, b.section, examJson, { topUp: true, shortfall }), _grammarUsedUpNote(P, layoutScope)].filter(Boolean).join('\n\n');
  logToFile('[assessment] section topped up again', { requestId, pattern, section: b.section.id, shortfall, grammar: 'used_up' });
  try {
    const second = await writeOne({ ...b, messages: _sectionMessages({ system, user: `${b.user}\n\n${note}`, pageContent: b.pageContent, model }) });
    usages.push(...second.usages);
    if (_reviewTextHits([{ id: b.section.id, tree: second.tree }]).size) return { examJson, laid, usages };
    stripImageKeys(second.tree);
    normaliseAnswers(second.tree);
    _dropProseVerses(second.tree, versesRef, requestId);
    let next = lay(_topUp(examJson, second.tree, new Set([READ_SLOT])));
    _blankWordsStems(next.examJson, P, key);
    if ((await religiousFilter(next.examJson, P, { grade, subject, allowedText: loaded.content, requestId })).length) next = lay(next.examJson);
    return { examJson: next.examJson, laid: next, usages };
  } catch (err) {
    logToFile('[assessment] grammar top-up failed', { requestId, section: b.section.id, error: err.message });
    return { examJson, laid, usages };
  }
}

module.exports = {
  _readerPassSst, _reaskQuoted, _topUpGrammarUsedUp,
};
