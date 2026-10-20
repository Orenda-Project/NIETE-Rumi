/**
 * Live moves (bd-v0toag.31): the v10 card's moves for the teacher's live list.
 *
 * The card JSON is not a DB asset: it sits in R2 beside the current card PDF,
 * at the same key with `.card.pdf` → `.card.json`, so it follows the card's
 * version without a migration. Never throws; any miss gives null and the
 * recorder simply shows no list.
 */
const supabase = require('../../../config/supabase');
const { downloadFromR2 } = require('../../../storage/r2');
const { logEvent } = require('../../../utils/structured-logger');

const TTL_MS = 10 * 60 * 1000;
const cache = new Map();

function jsonKeyFor(pdfKey) {
  return String(pdfKey || '').replace(/\.card\.pdf$/, '.card.json');
}

function flatten(lessonId, stamp, card) {
  let idx = 0;
  const sections = (card.sections || [])
    .filter((s) => s.sec !== 'hw')
    .map((s) => ({
      sec: s.sec,
      minutes: s.minutes,
      moves: (s.moves || []).map((m) => ({
        idx: idx++, covers: m.covers || [], chip: m.chip || '', do: m.do, say: m.say,
      })),
    }));
  return { lessonId, stamp, sections };
}

async function loadCardMoves(lessonId, deps = {}) {
  const db = deps.supabase || supabase;
  const getObject = deps.getObject || downloadFromR2;
  const log = deps.logEvent || logEvent;
  const now = deps.now || Date.now;
  if (!lessonId) return null;

  const hit = cache.get(lessonId);
  if (hit && now() - hit.at < TTL_MS) return hit.value;

  try {
    const { data: row, error } = await db
      .from('niete_lp_assets')
      .select('lesson_id, r2_key, version_stamp')
      .eq('lesson_id', lessonId)
      .eq('asset_kind', 'card')
      .eq('is_current', true)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!row || !/\.card\.pdf$/.test(row.r2_key || '')) return null;

    const body = await getObject(jsonKeyFor(row.r2_key));
    const value = flatten(lessonId, row.version_stamp, JSON.parse(body.toString('utf8')));
    cache.set(lessonId, { at: now(), value });
    return value;
  } catch (err) {
    log('live_moves.card.failed', { lessonId, error: err.message });
    return null;
  }
}

function _resetCache() {
  cache.clear();
}

module.exports = { loadCardMoves, jsonKeyFor, _resetCache };
