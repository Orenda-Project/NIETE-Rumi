'use strict';
/**
 * bot/whatsapp-bot.js registers the same ordered routes as the golden: every app.use/get/post/… call in order, with
 * its path, its handler names and, for a mounted router, that router's own layers (route paths, methods, handler
 * names). The optional first-touch mounts sit in that list, so their order and paths are pinned with everything
 * around them. Only the edges are doubled (no database, no Redis, no WhatsApp). Record once with UPDATE_GOLDEN=1.
 */
process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'http://localhost';
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'test-key';
process.env.OPENAI_API_KEY = process.env.OPENAI_API_KEY || 'test-key';
process.env.OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY || 'test-key';
process.env.INTERNAL_API_KEY = 'unit-internal-key-not-a-secret';

const fs = require('fs');
const path = require('path');

const GOLDEN = path.join(__dirname, '__goldens__', 'bot-mounts.json');
const METHODS = ['use', 'get', 'post', 'put', 'patch', 'delete', 'all'];

function routerOf(stack) {
  return stack.map((l) => (l.route
    ? { path: l.route.path, methods: Object.keys(l.route.methods).sort(), handlers: l.route.stack.map((s) => s.name) }
    : (Array.isArray(l.handle && l.handle.stack) ? { name: l.name, stack: routerOf(l.handle.stack) } : { name: l.name })));
}
const handler = (h) => (Array.isArray(h && h.stack) ? { name: h.name || '<anonymous>', stack: routerOf(h.stack) } : { name: (h && h.name) || '<anonymous>' });

test('whatsapp-bot.js registers the golden routes, in the golden order', () => {
  const calls = [];
  jest.doMock('express', () => {
    const real = jest.requireActual('express');
    const make = (...a) => {
      const app = real(...a);
      for (const m of METHODS) {
        const orig = app[m];
        app[m] = function record(...args) {
          if (!(m === 'get' && args.length === 1)) {   // app.get('setting') reads, it registers nothing
            const hasPath = typeof args[0] === 'string' || args[0] instanceof RegExp || Array.isArray(args[0]);
            const fns = hasPath ? args.slice(1) : args;
            calls.push({ app, call: { m, path: hasPath ? String(args[0]) : null, handlers: fns.flat().map(handler) } });
          }
          return orig.apply(this, args);
        };
      }
      return app;
    };
    return Object.assign(make, real);
  });
  jest.doMock('../../shared/config/supabase', () => ({ from: () => ({}), rpc: async () => ({ data: null, error: null }) }));
  jest.doMock('../../shared/services/cache/railway-redis.service', () => require('./_ingress-mocks').redisMock(jest));
  jest.doMock('../../shared/services/whatsapp.service', () => require('./_ingress-mocks').whatsappMock(jest));
  jest.doMock('../../shared/utils/web-drain', () => ({
    trackWebhookWork: (w) => w, installWebDrain: () => {}, inFlightCount: () => 0, waitForIdle: async () => true,
  }));
  const { app } = require('../../whatsapp-bot');
  const got = JSON.stringify(calls.filter((c) => c.app === app).map((c) => c.call), null, 2) + '\n';
  if (process.env.UPDATE_GOLDEN === '1') fs.writeFileSync(GOLDEN, got);
  expect(got).toBe(fs.readFileSync(GOLDEN, 'utf8'));
});
