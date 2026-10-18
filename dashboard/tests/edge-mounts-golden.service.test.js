'use strict';
/**
 * The edge block of dashboard/index.js (the child quiz router through the phone test page, before the body parsers)
 * builds the same ordered express stack as the golden: every layer's path pattern, route methods and handler names,
 * nested routers included. index.js itself is not loadable in a suite (Redis, listen), so the test runs that block's
 * own source text against a bare express app. Record once with TEACHER_HOME_RECORD=1.
 */
const fs = require('fs');
const path = require('path');
const Module = require('module');
const express = require('express');

const INDEX = path.join(__dirname, '..', 'index.js');
const GOLDEN = path.join(__dirname, 'fixtures', 'edge-mounts-stack.golden.json');
const FROM = '// Web child quiz (/q/:code';
const TO = '\n// Middleware\n';

function edgeBlock() {
  const src = fs.readFileSync(INDEX, 'utf8');
  const a = src.indexOf(FROM);
  const b = src.indexOf(TO, a);
  expect(a).toBeGreaterThan(-1);
  expect(b).toBeGreaterThan(a);
  return src.slice(a, b);
}

function dump(stack) {
  return stack.map((l) => {
    const out = { name: l.name, re: String(l.regexp) };
    if (l.route) {
      out.path = l.route.path;
      out.methods = Object.keys(l.route.methods).sort();
      out.handlers = l.route.stack.map((s) => s.name);
    } else if (l.handle && Array.isArray(l.handle.stack)) {
      out.stack = dump(l.handle.stack);
    }
    return out;
  });
}

test('the edge block builds the golden stack (same layers, same order)', () => {
  const app = express();
  // eslint-disable-next-line no-new-func
  new Function('app', 'require', 'express', 'path', '__dirname', edgeBlock())(
    app, Module.createRequire(INDEX), express, path, path.dirname(INDEX));
  const got = JSON.stringify(dump(app._router.stack), null, 2) + '\n';
  if (process.env.TEACHER_HOME_RECORD === '1') fs.writeFileSync(GOLDEN, got);
  expect(got).toBe(fs.readFileSync(GOLDEN, 'utf8'));
});

// Building the edge block never calls a bot, even with a bot address and key in the env (a dev .env): the web quiz
// router's background switch ask (lib/edge-learn.js) does not start inside a test run. The network is stubbed here.
test('the edge block makes no network call while it is built (a bot address and key set)', async () => {
  const env = { MAIN_BOT_URL: process.env.MAIN_BOT_URL, INTERNAL_API_KEY: process.env.INTERNAL_API_KEY };
  const had = global.fetch;
  const calls = [];
  process.env.MAIN_BOT_URL = 'http://bot.invalid';
  process.env.INTERNAL_API_KEY = 'dev-key-from-env';
  global.fetch = (...a) => { calls.push(String(a[0])); return new Promise(() => {}); };
  try {
    const app = express();
    // eslint-disable-next-line no-new-func
    new Function('app', 'require', 'express', 'path', '__dirname', edgeBlock())(
      app, Module.createRequire(INDEX), express, path, path.dirname(INDEX));
    await new Promise((r) => setTimeout(r, 30));
  } finally {
    global.fetch = had;
    Object.entries(env).forEach(([k, v]) => { if (v === undefined) delete process.env[k]; else process.env[k] = v; });
  }
  expect(calls).toEqual([]);
});
