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
