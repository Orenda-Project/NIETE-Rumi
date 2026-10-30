'use strict';
/**
 * bd-s42dye.1 — the coach app's Training Library (read-only). Mounted at /api/portal by dashboard/index.js, beside
 * portal.routes.js, so it shares the portal's CORS / rate-limit / session stack.
 *
 *   GET /api/portal/training/library                         { vendors: [ vendor → levels → courses → modules ] }
 *   GET /api/portal/training/library/module/:id              one part: body, presigned video / audio / pdf
 *   GET /api/portal/training/library/course/:id/readings     { available, unavailable }
 *   GET /api/portal/training/library/questions               ?module_id | ?level_id | ?course_id&kind=module_exam
 *
 * Every endpoint: 401 with no session; 403 { error: 'coach_only' } unless `users.role` (re-read on every request) is
 * exactly 'coach'; 404 { error: 'not_found' } for an unknown or inactive id; 400 { error: 'bad_request' } for a bad
 * question query; NEVER a write. No assignment, level-chain, module-order, exam or certificate gate runs, and the
 * answer key never leaves (see services/training-library.service.js). Logic lives in that service, not here.
 */
const express = require('express');
const supabase = require('../config/supabase');
const Library = require('../services/training-library.service');

const router = express.Router();

// The portal's one sign-in check (lib/portal-auth.js): it also ends the session of a retired account.
const { requirePortalAuth } = require('../lib/portal-auth');

/** The role is read from `users` on every call, never from the session; any failure to read it is a refusal. */
async function requireCoach(req, res, next) {
  let role = null;
  try {
    const { data, error } = await supabase
      .from('users').select('id, role').eq('id', req.session.portalUserId).maybeSingle();
    if (error) throw error;
    role = data ? data.role : null;
  } catch (error) {
    console.error('training library: role lookup failed', { error: error && error.message });
    return res.status(500).json({ error: 'role_check_failed' });
  }
  if (role !== 'coach') return res.status(403).json({ error: 'coach_only' });
  return next();
}

const NOT_FOUND = { error: 'not_found' };

function serve(name, run) {
  return async (req, res) => {
    try {
      const out = await run(req);
      if (out === null) return res.status(404).json(NOT_FOUND);
      return res.json(out);
    } catch (error) {
      console.error(`training library ${name} failed`, { error: error && error.message });
      return res.status(500).json({ error: 'library_failed' });
    }
  };
}

const guard = [requirePortalAuth, requireCoach];

router.get('/training/library', ...guard, serve('tree', () => Library.loadLibrary(supabase)));

router.get('/training/library/module/:id', ...guard,
  serve('module', (req) => Library.loadModule(supabase, req.params.id)));

router.get('/training/library/course/:id/readings', ...guard,
  serve('readings', (req) => Library.loadReadings(supabase, req.params.id)));

/** Exactly one of module_id | level_id | course_id (with kind=module_exam). Returns { scope, id } or null. */
function questionTarget(query) {
  const q = query || {};
  const has = (k) => q[k] !== undefined && q[k] !== '';
  const forms = ['module_id', 'level_id', 'course_id'].filter(has);
  if (forms.length !== 1) return null;
  if (has('kind') && !has('course_id')) return null;
  const [form] = forms;
  if (form === 'course_id' && q.kind !== 'module_exam') return null;
  const id = Library.toId(q[form]);
  if (id === null) return null;
  return { scope: { module_id: 'module', level_id: 'level', course_id: 'module_exam' }[form], id };
}

router.get('/training/library/questions', ...guard, (req, res) => {
  const target = questionTarget(req.query);
  if (!target) return res.status(400).json({ error: 'bad_request' });
  return serve('questions', () => Library.loadQuestions(supabase, target.scope, target.id))(req, res);
});

module.exports = router;
