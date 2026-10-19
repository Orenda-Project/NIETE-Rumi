'use strict';
/**
 * bd-t7zk3t.12 (PR-D) — the leader routes of Reading Hour + Numeracy (FLN), contracts/api.md v2.
 * Mounted from m-app's `portal-fln.routes.js` (itself at /api/portal) by ONE line the m-links manager adds after
 * PR-C lands: `router.use(require('./portal-fln-links.routes'));`. `GET /fln/me` is m-app's (PR-C), not here.
 *
 *   GET /fln/links       the "Send a lesson plan" builder's rows — requireFln.share (404 for everyone else)
 *   GET /fln/title/:id   {title, lang, dir} for the signed-out sign-in banner; no sign-in, nothing else
 *   GET /fln/teachers, POST /fln/send   Send to teacher (PR-E) — portal-fln-send.routes.js, mounted by this router
 *
 * Every answer, errors included, is `Cache-Control: no-store` (shared phones: a coach's rows must never be replayed
 * for the teacher who signs in next). The link a row carries is `<portal>/portal/fln/p/<id>` — no identity, no
 * expiry, the same for every sender and receiver (contracts/deep-link.md).
 *
 * The corpus (dashboard/services/fln-corpus.service.js) is injected or required lazily on the first request, so this
 * file never loads the bundle at require time.
 */
const express = require('express');
const access = require('../lib/fln-access');
const { portalUrl } = require('../../bot/shared/config/branding');
const { isTeachersValue } = require('../../bot/shared/services/teacher-audience');

const SUBJECTS = new Set(['rh-en', 'rh-ur', 'num']);
const HAS = new Set(['sounds', 'narration', 'additional', 'textbook', 'screener']);
const SORTS = new Set(['order', 'used']);
const Q_MAX = 100;

function badRequest(res) { return res.status(400).json({ error: 'bad_request' }); }
function unavailable(res) { return res.status(503).json({ error: 'fln_unavailable' }); }

/** One value or undefined; a repeated key (?grade=1&grade=2) is malformed. */
function one(v) {
  if (Array.isArray(v) || (v !== undefined && typeof v !== 'string')) return { bad: true };
  return { value: v };
}

function intIn(raw, lo, hi) {
  if (!/^\d{1,2}$/.test(raw)) return null;
  const n = Number(raw);
  return n >= lo && n <= hi ? n : null;
}

/** The builder's query, validated whole; null = 400. */
function parseLinksQuery(query) {
  const grade = one(query.grade); const subject = one(query.subject); const level = one(query.level);
  const q = one(query.q); const has = one(query.has); const sort = one(query.sort);
  if ([grade, subject, level, q, has, sort].some((p) => p.bad)) return null;
  const g = grade.value === undefined ? null : intIn(grade.value, 1, 12);
  if (g === null) return null;
  if (!SUBJECTS.has(subject.value)) return null;
  let lv = null;
  if (level.value !== undefined && level.value !== '') {
    lv = intIn(level.value, 1, 3);
    if (lv === null) return null;
  }
  const text = (q.value || '').trim();
  if (Array.from(text).length > Q_MAX) return null;
  let chips = [];
  if (has.value !== undefined && has.value !== '') {
    chips = has.value.split(',').map((s) => s.trim());
    if (chips.some((c) => !HAS.has(c))) return null;
  }
  const order = sort.value === undefined || sort.value === '' ? 'order' : sort.value;
  if (!SORTS.has(order)) return null;
  return { grade: g, subject: subject.value, level: lv, q: text, has: chips, sort: order };
}

function isScreener(r) { return !!(r.chips && r.chips.screener) || r.label === 'screener'; }
function isGuide(r) { return !!(r.chips && r.chips.guide) || r.label === 'guide'; }

function hasChip(r, chip) {
  const c = r.chips || {};
  switch (chip) {
    // A screener's clips are an answer key, not sounds to drill (DESIGN v2 §6): never "has sounds".
    case 'sounds': return !isScreener(r) && ((c.sounds || 0) > 0 || (c.words || 0) > 0);
    case 'narration': return !!c.narration;
    case 'additional': return !!c.additional || r.label === 'additional_practice';
    case 'textbook': return !!c.textbook || r.label === 'needs_textbook';
    case 'screener': return isScreener(r);
    default: return false;
  }
}

/** A catalogue body → flat rows in teaching order, each with its level's placement fields. */
function flatten(cat, linkFor) {
  if (!cat || typeof cat !== 'object' || !Array.isArray(cat.strands)) throw new Error('fln_catalogue_shape');
  const level = cat.level;
  const lv = (cat.levels || []).find((l) => l && l.level === level) || {};
  const out = [];
  for (const strand of cat.strands) {
    for (const ch of (strand && strand.chapters) || []) {
      for (const p of (ch && ch.plans) || []) {
        out.push({
          ...p,
          url: linkFor(p.id),
          level,
          grades: Array.isArray(lv.grades) ? lv.grades : [],
          chapter_title_en: ch.title_en ?? null,
          chapter_title_ur: ch.title_ur ?? null,
          pos: p.pos ?? null,
          count: p.count ?? lv.count ?? null,
          ...(typeof p.used_by === 'number' ? { used_by: p.used_by } : {}),
        });
      }
    }
  }
  return out;
}

function dedupe(rows) {
  const seen = new Set();
  return rows.filter((r) => (seen.has(r.id) ? false : (seen.add(r.id), true)));
}

/** "Most used" first, behind the pinned guide/screener rows; ties keep teaching order. */
function byUse(rows) {
  const pinned = rows.filter((r) => isGuide(r) || isScreener(r));
  const rest = rows.filter((r) => !isGuide(r) && !isScreener(r))
    .map((r, i) => ({ r, i }))
    .sort((a, b) => ((b.r.used_by ?? -1) - (a.r.used_by ?? -1)) || (a.i - b.i))
    .map((x) => x.r);
  return [...pinned, ...rest];
}

/**
 * Is either FLN switch ON for anyone? `true`, "true", "teachers" (raw or as JSON text) or a non-empty list of ids.
 * Anything else, a missing row or a failed read is OFF (fail closed, as isFlagEnabled). /fln/title has no signed-in
 * user to ask about, so this is its switch: with both off it is 404 like every other FLN route (RT #2953, api.md).
 */
function switchValueOn(raw) {
  let v = raw;
  if (typeof v === 'string') {
    try { v = JSON.parse(v); } catch (_) { /* a bare string */ }
  }
  if (v === true) return true;
  if (typeof v === 'string') return v.trim().toLowerCase() === 'true' || isTeachersValue(v);
  return Array.isArray(v) && v.some((id) => typeof id === 'string' && id.trim() !== '');
}

async function flnOnForAnyone() {
  // eslint-disable-next-line global-require
  const supabase = require('../config/supabase');
  const keys = [access.FLN_LESSONS_KEY || 'portal_fln_lessons', access.FLN_SHARE_KEY || 'portal_fln_share'];
  try {
    const reads = await Promise.all(keys.map((k) => supabase.from('app_settings').select('value').eq('key', k).maybeSingle()));
    return reads.some((r) => r && !r.error && r.data && switchValueOn(r.data.value));
  } catch (_) {
    return false;
  }
}

function originOf(req, portalOrigin) {
  const configured = portalOrigin();
  if (configured) return String(configured).replace(/\/+$/, '');
  return `${req.protocol}://${req.get('host')}`;
}

/**
 * @param {object} [deps]
 * @param {object} [deps.corpus]  the fln-corpus service (ensure, catalogue({grade, subject, level}), plan, isHidden);
 *                                default required on first use
 * @param {object} [deps.access]  fln-access (requireFln, noStore)
 * @param {() => string|null} [deps.portalOrigin]  the portal's public origin; default PORTAL_URL (branding)
 */
function createFlnLinksRouter({ corpus, access: acc = access, portalOrigin = portalUrl, flnOn = flnOnForAnyone } = {}) {
  const router = express.Router();
  let svc = corpus || null;
  // eslint-disable-next-line global-require
  const getCorpus = () => { if (!svc) svc = require('../services/fln-corpus.service'); return svc; };

  router.get('/fln/links', ...acc.requireFln.share, async (req, res) => {
    const p = parseLinksQuery(req.query || {});
    if (!p) return badRequest(res);
    const origin = originOf(req, portalOrigin);
    const linkFor = (id) => `${origin}/portal/fln/p/${encodeURIComponent(String(id))}`;
    let rows;
    try {
      const c = getCorpus();
      // The service loads the bundle lazily: a cold process (restart, a second replica) must load it first, and a
      // bundle that cannot load is 503, never an empty 200 (RT #2953).
      if (!(await c.ensure())) return unavailable(res);
      const cat = async (level) => {
        const out = await c.catalogue({ grade: p.grade, subject: p.subject, level });
        if (!out) throw new Error('catalogue unavailable');
        return out;
      };
      if (p.grade >= 6 && !p.level) {
        // Grades 6–12 with no level: the screener of every level on top, then each level in teaching order.
        const per = [];
        for (const lv of [1, 2, 3]) {
          // eslint-disable-next-line no-await-in-loop
          per.push(flatten(await cat(lv), linkFor));
        }
        rows = dedupe([...per.flatMap((r) => r.filter(isScreener)), ...per.flatMap((r) => r.filter((x) => !isScreener(x)))]);
      } else {
        rows = dedupe(flatten(await cat(p.level), linkFor));
      }
    } catch (_) {
      return unavailable(res);
    }
    if (p.q) {
      const needle = p.q.toLocaleLowerCase();
      rows = rows.filter((r) => String(r.title || '').toLocaleLowerCase().includes(needle));
    }
    if (p.has.length) rows = rows.filter((r) => p.has.every((chip) => hasChip(r, chip)));
    if (p.sort === 'used' && !p.q && rows.some((r) => typeof r.used_by === 'number')) rows = byUse(rows);
    return res.json({ rows });
  });

  // Signed out on purpose: the sign-in page's banner names the plan before anyone is known. Title, lang, dir only.
  // 404 while both FLN switches are off for everyone (flnOnForAnyone), like every other FLN route.
  router.get('/fln/title/:id', acc.noStore, async (req, res) => {
    const id = String(req.params.id || '');
    if (!/^\d{1,12}$/.test(id)) return res.status(404).json({ error: 'not_found' });
    if (!(await flnOn())) return res.status(404).json({ error: 'not_found' });
    try {
      const c = getCorpus();
      if (!(await c.ensure())) return unavailable(res); // unloaded, every id reads as hidden: not a 404
      if (await c.isHidden(id)) return res.status(404).json({ error: 'not_found' });
      const plan = await c.plan(id);
      if (!plan || typeof plan.title !== 'string') return res.status(404).json({ error: 'not_found' });
      return res.json({ title: plan.title, lang: plan.lang === 'ur' ? 'ur' : 'en', dir: plan.dir === 'rtl' ? 'rtl' : 'ltr' });
    } catch (_) {
      return unavailable(res);
    }
  });

  // PR-E: GET /fln/teachers and POST /fln/send live in their own file, `portal-fln-send.routes.js`, mounted here so
  // they are reachable wherever this router is. Same access object (same requireFln.share gate) and same corpus.
  router.use(require('./portal-fln-send.routes').createFlnSendRouter({ requireFln: acc.requireFln, corpus: corpus || null }));

  return router;
}

const router = createFlnLinksRouter();
router.createFlnLinksRouter = createFlnLinksRouter;
module.exports = router;
module.exports.createFlnLinksRouter = createFlnLinksRouter;
module.exports.parseLinksQuery = parseLinksQuery;
module.exports.switchValueOn = switchValueOn;
