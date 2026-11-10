'use strict';
/**
 * bd-snkn32.16 — the AI reviewer of a teacher's own plan (job lp.ownReview, a cheaper model).
 *
 * WHEN. After her row is `ready` (lp612-own.worker calls review() once her plan is stored), so it adds no wait:
 * the waiting page already has her plan. Any later path that makes a row ready again (a change) calls it the same way.
 *
 * WHAT IT WRITES. Only the review columns of her row (V1.9.9): review_score, review_pass, review_items,
 * review_model, reviewed_at, library_eligible. Never her status, never her PDF. The score decides ONLY whether her
 * plan may join the shared library; she always has her plan, below 85 or not.
 *
 * FAILURE. A model error, an unreadable reply or a missing plan logs and returns null: her score stays null, which
 * the library reads as not eligible. It never throws.
 *
 * Dependencies are injected (createOwnReviewer) so it is testable without Supabase, R2 or a model.
 */
const { gateV2, parseReview, reviewMessages } = require('./lp612-own-review');

const OWN_TABLE = 'niete_lp612_own_plans';
const REVIEW_JOB = 'lp.ownReview';
const REVIEW_READ = 'id, status, lang, segment_id, lesson_id, r2_key';

/** The document stored beside her PDF: `.lp.json` for a 6-12 fork, `.json` (slide script) for a grades 1-5 day. */
function planKeyFor(row) {
  if (!row || !row.r2_key || !/\.pdf$/.test(row.r2_key)) return null;
  return row.r2_key.replace(/\.pdf$/, row.lesson_id ? '.json' : '.lp.json');
}

function createOwnReviewer(deps) {
  const d = deps;

  async function score(messages) {
    const res = await d.client.chat.completions.create({
      model: d.model, job: REVIEW_JOB, temperature: 0, messages,
      max_completion_tokens: 4000, response_format: { type: 'json_object' }, reasoning: { enabled: false },
    });
    const items = parseReview(res && res.choices && res.choices[0] && res.choices[0].message.content);
    if (!items) throw new Error('the reply had no ratings');
    return items;
  }

  async function review(ownId, correlationId = null) {
    try {
      const row = await d.selectRow(ownId);
      if (!row || row.status !== 'ready') return null;
      const key = planKeyFor(row);
      if (!key) return null;
      const plan = await d.readPlan(key);
      const messages = reviewMessages({ plan, lang: row.lang });
      const items = await score(messages);
      let g = gateV2(items);
      if (g.rescore) g = gateV2(items, await score(messages));
      const fields = {
        review_score: Math.round(g.pct * 10) / 10,
        review_pass: g.pass,
        review_items: items,
        review_model: d.model,
        reviewed_at: d.now(),
        library_eligible: g.pass,
      };
      await d.patchOwn(row.id, fields);
      return { pass: g.pass, score: fields.review_score, reasons: g.reasons };
    } catch (err) {
      d.log('LP own review: not scored', { ownId, error: err && err.message, correlationId });
      return null;
    }
  }

  return { review };
}

function liveDeps() {
  const supabase = require('../config/supabase');
  const { logToFile } = require('../utils/logger');
  return {
    selectRow: async (id) => {
      const { data, error } = await supabase.from('niete_lp612_own_plans').select(REVIEW_READ).eq('id', id).maybeSingle();
      if (error) throw new Error(error.message);
      return data || null;
    },
    readPlan: async (key) => (await require('../storage/r2').downloadFromR2(key)).toString('utf8'),
    client: require('./llm-client').getClient(),
    model: require('../config/model-registry').modelFor(REVIEW_JOB),
    patchOwn: async (id, fields) => {
      const { error } = await supabase.from('niete_lp612_own_plans').update({ ...fields, updated_at: new Date().toISOString() }).eq('id', id);
      if (error) throw new Error(error.message);
    },
    now: () => new Date().toISOString(),
    log: (m, x) => logToFile(m, x),
  };
}

let live = null;

module.exports = {
  createOwnReviewer,
  planKeyFor,
  review: (ownId, correlationId) => { live = live || createOwnReviewer(liveDeps()); return live.review(ownId, correlationId); },
  REVIEW_JOB,
  OWN_TABLE,
};
