'use strict';
/**
 * FLN Send to teacher (PR-E, m-links) — the portal half.
 *
 *   GET  /fln/teachers?q=   → {teachers:[{key, name, school?}]}  the leader's OWN scope, keyed ids only
 *   POST /fln/send {plan, teachers:[key…]} → {queued, failed:[key…]}
 *
 * Mounted by portal-fln-links.routes.js (createFlnLinksRouter: `router.use(createFlnSendRouter({requireFln, corpus}))`),
 * so it is reachable wherever the links router is mounted (/api/portal).
 * Both routes sit behind `requireFln.share` (dashboard/lib/fln-access.js, owner m-app: no-store, 401 signed out,
 * 404 unless a leader with portal_fln_share) — 404 is "no FLN here" to the client. Every answer is no-store.
 *
 * SCOPE = getPatchTeachers(query, leaderUserId, {role}) (dashboard/services/leader-patch.service.js, identical on
 * sandbox and main): the allocation My Patch and the leader teacher list already use — coach / aeo / supervisor /
 * school_leader → their leader_schools; principal → their own school. Only teachers on Rumi, never the leader,
 * never a principal row. A key is fln-keys teacherKey(users.id): the server maps it back by recomputing it over
 * this same scope, so a key outside the scope matches nobody → 403 and nothing is sent (no token is minted).
 *
 * POST order: 400 (malformed, 0 or >30 keys) → 404 (plan hidden or unknown, via the injected corpus) → 403 (any key
 * out of scope) → 429 {error:'rate_limited'} (30 recipients per leader per rolling hour; IN MEMORY, per process —
 * a second replica has its own count) → the bot (POST MAIN_BOT_URL/api/internal/fln/send, x-api-key
 * INTERNAL_API_KEY, the path every portal send uses). Bot unreachable → 503 {error:'fln_unavailable'}, and the
 * reservation is released. The bot resolves phone numbers and writes the `send` events; nothing personal leaves
 * this file.
 */
const express = require('express');
const { getPatchTeachers } = require('../services/leader-patch.service');
const { teacherKey, KEY_RX } = require('../../bot/shared/services/fln-keys');

const MAX_PER_REQUEST = 30;
const MAX_PER_HOUR = 30;
const HOUR_MS = 60 * 60 * 1000;
const PLAN_RX = /^\d{1,9}$/;
const Q_MAX = 60;

/** Recipients per leader in a rolling hour. In memory, per process. */
function createRecipientLimiter({ max = MAX_PER_HOUR, windowMs = HOUR_MS, now = Date.now } = {}) {
  const used = new Map(); // leaderId -> [{at, n}]
  const live = (leader) => {
    const t = now();
    const rows = (used.get(leader) || []).filter((r) => t - r.at < windowMs);
    used.set(leader, rows);
    return rows;
  };
  return {
    reserve(leader, n) {
      const rows = live(leader);
      const total = rows.reduce((s, r) => s + r.n, 0);
      if (total + n > max) return null;
      const entry = { at: now(), n };
      rows.push(entry);
      return entry;
    },
    release(leader, entry) {
      const rows = used.get(leader) || [];
      const i = rows.indexOf(entry);
      if (i >= 0) rows.splice(i, 1);
    },
  };
}

function defaultCorpus() {
  // m-app's corpus service (PR-C). Absent or not loaded → the caller answers 503.
  return require('../services/fln-corpus.service');
}

function defaultBotUrl() {
  return String(process.env.MAIN_BOT_URL || '').replace(/\/+$/, '');
}

function defaultHttpPost(url, body, opts) {
  return require('axios').post(url, body, { ...opts, validateStatus: () => true });
}

function createFlnSendRouter({
  requireFln = require('../lib/fln-access').requireFln,
  query = (text, params) => require('../config/database').query(text, params),
  corpus = null,
  botUrl = null,
  httpPost = defaultHttpPost,
  now = Date.now,
  limiter = null,
} = {}) {
  const router = express.Router();
  const limits = limiter || createRecipientLimiter({ now });
  const share = requireFln.share;

  /** The leader's sendable teachers, keyed. Null when no key can be derived here. */
  async function scopeFor(req) {
    const leaderId = req.session.portalUserId;
    const patch = await getPatchTeachers(query, leaderId, { role: req.fln && req.fln.role });
    const out = [];
    for (const t of patch || []) {
      if (!t || !t.rumiUserId || t.isPrincipal || String(t.rumiUserId) === String(leaderId)) continue;
      const key = teacherKey(t.rumiUserId);
      if (!key) return null;
      out.push({ key, id: String(t.rumiUserId), name: t.name, school: t.schoolName || null });
    }
    return out;
  }

  router.get('/fln/teachers', ...share, async (req, res) => {
    try {
      const scope = await scopeFor(req);
      if (!scope) return res.status(503).json({ error: 'fln_unavailable' });
      const q = String(req.query.q || '').trim().toLowerCase().slice(0, Q_MAX);
      const rows = q ? scope.filter((t) => String(t.name || '').toLowerCase().includes(q)) : scope;
      return res.json({ teachers: rows.map((t) => ({ key: t.key, name: t.name, ...(t.school ? { school: t.school } : {}) })) });
    } catch (err) {
      console.error('fln/teachers error:', err && err.message);
      return res.status(503).json({ error: 'fln_unavailable' });
    }
  });

  router.post('/fln/send', ...share, express.json({ limit: '16kb' }), async (req, res) => {
    const b = req.body || {};
    const planId = String(b.plan == null ? '' : b.plan);
    const keys = Array.isArray(b.teachers) ? [...new Set(b.teachers.map(String))] : null;
    if (!PLAN_RX.test(planId) || !keys || keys.length < 1 || b.teachers.length > MAX_PER_REQUEST
      || !keys.every((k) => KEY_RX.test(k))) {
      return res.status(400).json({ error: 'bad_request' });
    }

    let plan;
    try {
      const c = corpus || defaultCorpus();
      // The corpus service is lazy: unloaded, every id reads as hidden. Load first; unloadable is 503 (RT #2956).
      if (typeof c.ensure === 'function' && !(await c.ensure())) return res.status(503).json({ error: 'fln_unavailable' });
      if (await c.isHidden(planId)) return res.status(404).json({ error: 'not_found' });
      plan = await c.plan(planId);
    } catch (err) {
      return res.status(503).json({ error: 'fln_unavailable' });
    }
    if (!plan || typeof plan.title !== 'string') return res.status(404).json({ error: 'not_found' });

    let scope;
    try {
      scope = await scopeFor(req);
    } catch (err) {
      console.error('fln/send scope error:', err && err.message);
      return res.status(503).json({ error: 'fln_unavailable' });
    }
    if (!scope) return res.status(503).json({ error: 'fln_unavailable' });
    const byKey = new Map(scope.map((t) => [t.key, t]));
    if (!keys.every((k) => byKey.has(k))) return res.status(403).json({ error: 'forbidden' });

    const leaderId = req.session.portalUserId;
    const reservation = limits.reserve(leaderId, keys.length);
    if (!reservation) return res.status(429).json({ error: 'rate_limited' });

    const base = botUrl || defaultBotUrl();
    const apiKey = process.env.INTERNAL_API_KEY || '';
    try {
      if (!base || !apiKey) throw new Error('not_configured');
      const r = await httpPost(`${base}/api/internal/fln/send`, {
        sender: { id: leaderId, role: (req.fln && req.fln.role) || '' },
        plan: { id: planId, title: plan.title, lang: plan.lang },
        teachers: keys.map((k) => ({ id: byKey.get(k).id, key: k })),
      }, { headers: { 'x-api-key': apiKey, 'Content-Type': 'application/json' }, timeout: 60000 });
      const d = r && r.data;
      if (!r || r.status !== 200 || !d || d.success !== true) throw new Error(`bot answered ${r && r.status}`);
      return res.json({ queued: Number(d.queued) || 0, failed: Array.isArray(d.failed) ? d.failed : [] });
    } catch (err) {
      limits.release(leaderId, reservation);
      console.error('fln/send bot error:', err && err.message);
      return res.status(503).json({ error: 'fln_unavailable' });
    }
  });

  return router;
}

module.exports = { createFlnSendRouter, createRecipientLimiter, MAX_PER_REQUEST, MAX_PER_HOUR };
