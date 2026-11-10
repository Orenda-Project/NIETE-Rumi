'use strict';
/**
 * bd-snkn32.15 — "Change this plan": the request. A teacher may change a finished own plan twice. Each change is a
 * NEW row of niete_lp612_own_plans under the root plan (parent_own_id = root, edit_round 1 or 2, edit_request
 * {part, text}); the worker rewrites the latest ready plan in the chain with the same rewrite path as a make.
 *
 * Every refusal (lp-own-edit-guard) happens here, before a row is written or a model is paid for. The database holds
 * the cap: round is 1 or 2 and (root, round) is unique among rows that did not fail, so two taps at once insert one row.
 *
 * Dependencies are injected (createChangeService); liveDeps reuses the own-plan service's wiring.
 */
const { checkChange, karachiDayStart, bandOf } = require('./lp-own-edit-guard');
const Own = require('./lp612-own.service');

function createChangeService(deps) {
  const d = deps;
  const now = () => (d.now ? d.now() : Date.now());

  async function requestChange({ userId, ownId, part, text, correlationId = null } = {}) {
    if (!userId || !ownId) return { outcome: 'bad_request' };
    const asked = await d.selectOwn(ownId, userId);
    if (!asked || asked.user_id !== userId) return { outcome: 'not_found' };
    const rootId = asked.parent_own_id || asked.id;
    const chain = await d.listChain(rootId, userId);
    const root = chain.find((r) => r && r.id === rootId);
    if (!root) return { outcome: 'not_found' };

    const band = bandOf(root);
    const todayCount = await d.countToday(userId, karachiDayStart(now()));
    const ok = checkChange({ band, part, text, chain, todayCount });
    if (!ok.ok) return { outcome: ok.outcome };

    const key = band === 'k5' ? root.lesson_id : root.segment_id;
    const row = await d.insertOwn({
      user_id: userId,
      [band === 'k5' ? 'lesson_id' : 'segment_id']: key,
      lang: root.lang,
      template_version: root.template_version,
      answers: root.answers,
      status: 'authoring',
      correlation_id: correlationId,
      parent_own_id: rootId,
      edit_round: ok.round,
      edit_request: { part: ok.part, text: ok.text },
    });
    if (row && row.conflict) return { outcome: 'in_flight' };
    if (!row || !row.id) return { outcome: 'error' };
    return Own.queueOwn(d, row, key, correlationId);
  }

  return { requestChange };
}

/** The live wiring: the own-plan service's, with an insert that tells a lost race (unique round) from a failure. */
function liveDeps() {
  const base = Own.liveDeps();
  const supabase = require('../config/supabase');
  return {
    ...base,
    insertOwn: async (row) => {
      const out = await supabase.from(Own.OWN_TABLE).insert(row).select('id').single();
      if (out.error && out.error.code === '23505') return { conflict: true };
      if (out.error) base.log('LP own change: insert failed', { root: row.parent_own_id, reason: out.error.message });
      return out.error ? null : out.data;
    },
  };
}

let live = null;
const service = () => { live = live || createChangeService(liveDeps()); return live; };

module.exports = { createChangeService, requestChange: (args) => service().requestChange(args) };
