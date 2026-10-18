'use strict';
/**
 * The optional first-touch mount block of bot/whatsapp-bot.js (from its first "── first touch:" marker up to the
 * general internal router) registers the same ordered routes as the golden: every app.use/get/post/… call in order,
 * with its path, its handler names and, for a mounted router, that router's own layers (route paths, methods, handler
 * names). Only that block is run, against a bare express app, so a route added anywhere else never touches it.
 * Only the edges are doubled (no database, no Redis). Record once with TEACHER_HOME_RECORD=1.
 */
process.env.INTERNAL_API_KEY = 'unit-internal-key-not-a-secret';
jest.mock('../../shared/config/supabase', () => ({}));
jest.mock('../../shared/services/cache/railway-redis.service', () => require('./_ingress-mocks').redisMock(jest));
jest.mock('../../shared/utils/logger', () => ({ logToFile: jest.fn(), logError: jest.fn() }));
jest.mock('../../shared/utils/structured-logger', () => ({ logEvent: jest.fn() }));

const fs = require('fs');
const path = require('path');
const express = require('express');

const BOT = path.join(__dirname, '..', '..');
const GOLDEN = path.join(__dirname, '__goldens__', 'bot-mounts.json');
const FROM = '// ── first touch:';
const TO = '\nconst internalApiRoutes';
const METHODS = ['use', 'get', 'post', 'put', 'patch', 'delete', 'all'];

function mountBlock() {
  const src = fs.readFileSync(path.join(BOT, 'whatsapp-bot.js'), 'utf8');
  const a = src.indexOf(FROM);
  const b = src.indexOf(TO, a);
  expect(a).toBeGreaterThan(-1);
  expect(b).toBeGreaterThan(a);
  return src.slice(a, b);
}

function routerOf(stack) {
  return stack.map((l) => (l.route
    ? { path: l.route.path, methods: Object.keys(l.route.methods).sort(), handlers: l.route.stack.map((s) => s.name) }
    : (Array.isArray(l.handle && l.handle.stack) ? { name: l.name, stack: routerOf(l.handle.stack) } : { name: l.name })));
}
const handler = (h) => (Array.isArray(h && h.stack) ? { name: h.name || '<anonymous>', stack: routerOf(h.stack) } : { name: (h && h.name) || '<anonymous>' });

test('the first-touch mount block registers the golden routes, in the golden order', () => {
  const app = express();
  const calls = [];
  for (const m of METHODS) {
    const orig = app[m];
    app[m] = function record(...args) {
      const hasPath = typeof args[0] === 'string' || args[0] instanceof RegExp || Array.isArray(args[0]);
      calls.push({ m, path: hasPath ? String(args[0]) : null, handlers: (hasPath ? args.slice(1) : args).flat().map(handler) });
      return orig.apply(this, args);
    };
  }
  const req = (p) => require(p.startsWith('.') ? path.join(BOT, p) : p);
  // eslint-disable-next-line no-new-func
  new Function('app', 'require', mountBlock())(app, req);
  expect(calls.length).toBeGreaterThan(0);
  const got = JSON.stringify(calls, null, 2) + '\n';
  if (process.env.TEACHER_HOME_RECORD === '1') fs.writeFileSync(GOLDEN, got);
  expect(got).toBe(fs.readFileSync(GOLDEN, 'utf8'));
});
