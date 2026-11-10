'use strict';
/**
 * (unified spec item 7, screen 9) — her made plan as section cards for the portal viewer. The PDF stays the
 * source; the cards are read from the JSON stored beside it (baseJsonKey): a grades 1–5 script (hook / iDo / weDo /
 * youDo / wrap) or a 6–12 lp.json (objectives, then `sections` by id). The parts are the change guard's (PARTS), so a
 * card is always a section she can change. After a change, the changed card carries its text from the plan before.
 *
 * sectionsOf is pure; ownSections takes its reads injected (selectOwn, listChain, readJson).
 */
const { PARTS, bandOf, baseJsonKey, editBase } = require('./lp-own-edit-guard');

const K5_KEYS = { hook: 'hook', i_do: 'iDo', we_do: 'weDo', you_do: 'youDo', wrap: 'wrap' };
// Layout fields, not words she reads.
const SKIP = new Set(['id', 'type', 'minutes', 'ref', 'tier', 'level', 'mode', 'slo', 'slo_code', 'slo_codes', 'meta']);

function flatten(v, out = []) {
  if (typeof v === 'string') { if (v.trim()) out.push(v.trim()); } else if (Array.isArray(v)) {
    for (const x of v) flatten(x, out);
  } else if (v && typeof v === 'object') {
    for (const [k, x] of Object.entries(v)) if (!SKIP.has(k)) flatten(x, out);
  }
  return out;
}

/** [{ part, text }] in the plan's order; parts with no text are left out. */
function sectionsOf(doc, band) {
  if (!doc || typeof doc !== 'object' || !PARTS[band]) return [];
  const secs = Array.isArray(doc.sections) ? doc.sections : [];
  const node = (part) => {
    if (band === 'k5') return doc[K5_KEYS[part]];
    if (part === 'objectives') return doc.objectives;
    const s = secs.find((x) => x && x.id === part);
    return s && s.blocks;
  };
  return PARTS[band].map((part) => ({ part, text: flatten(node(part)).join('\n') })).filter((s) => s.text);
}

const NONE = { outcome: 'not_found' };

async function ownSections(d, { ownId, userId } = {}) {
  if (!ownId || !userId) return NONE;
  const row = await d.selectOwn(ownId, userId);
  if (!row || row.user_id !== userId || row.status !== 'ready') return NONE;
  const band = bandOf(row);
  const key = baseJsonKey(row.r2_key, band);
  const doc = key ? await d.readJson(key) : null;
  const sections = sectionsOf(doc, band);
  if (!sections.length) return NONE;
  if (!row.parent_own_id) return { outcome: 'ok', band, sections, changed: null };

  const chain = (await d.listChain(row.parent_own_id, userId)) || [];
  const me = chain.find((r) => r && r.id === row.id) || row;
  const part = (me.edit_request && me.edit_request.part) || null;
  const prev = editBase(chain.filter((r) => r && r.id !== row.id && (r.edit_round || 0) < (me.edit_round || 0)));
  const prevKey = prev && baseJsonKey(prev.r2_key, band);
  const was = prevKey ? sectionsOf(await d.readJson(prevKey), band).find((s) => s.part === part) : null;
  return {
    outcome: 'ok', band, changed: part,
    sections: sections.map((s) => (was && s.part === part ? { ...s, before: was.text } : s)),
  };
}

/** The live reads: the own-plan service's, plus the stored JSON from R2 (null when it cannot be read). */
function liveDeps() {
  const base = require('./lp612-own.service').liveDeps();
  return {
    selectOwn: base.selectOwn,
    listChain: base.listChain,
    readJson: async (key) => {
      try {
        return JSON.parse((await require('../storage/r2').downloadFromR2(key)).toString('utf8'));
      } catch (err) {
        base.log('LP own sections: could not read the stored plan', { key, error: err.message });
        return null;
      }
    },
  };
}

let live = null;
module.exports = {
  sectionsOf,
  ownSections,
  ownSectionsLive: (args) => { live = live || liveDeps(); return ownSections(live, args); },
};
