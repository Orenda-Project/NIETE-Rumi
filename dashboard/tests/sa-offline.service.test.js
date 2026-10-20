'use strict';
/**
 * The offline copy (dashboard/sa/sw.js, sa-offline.js): the worker answers only /sa/ engine files (network first) and
 * the battery's files and clips (cache first) — never the sink's /api calls, /wq/'s pages or another origin; the page
 * asks it to keep exactly this session's clips, in this language.
 */
const { strategyFor, CORE_FILES } = require('../sa/sw');
const { urls } = require('../sa/sa-offline');
const MINI = require('./fixtures/sa-battery.g3-ur.mini.json');

const O = 'https://portal.test';

test('the worker answers its own files only', () => {
  expect(strategyFor(`${O}/sa/play.html?s=1&mode=game`, 'GET', O)).toBe('core');
  expect(strategyFor(`${O}/sa/sa-core.js?v=abc`, 'GET', O)).toBe('core');
  expect(strategyFor(`${O}/sa/v1/ur/5d5755a48131.mp3`, 'GET', O)).toBe('static');
  expect(strategyFor(`${O}/sa/batteries/sa.coach.G3.A.ur.json`, 'GET', O)).toBe('static');
  expect(strategyFor(`${O}/wq/jugnu_sleep.webp`, 'GET', O)).toBe('static');
  expect(strategyFor(`${O}/sa/sw.js`, 'GET', O)).toBeNull();
  expect(strategyFor(`${O}/api/portal/child-test/sa/session/1/batch`, 'POST', O)).toBeNull();
  expect(strategyFor(`${O}/api/portal/child-test/sa/session/1/status`, 'GET', O)).toBeNull();
  expect(strategyFor(`${O}/wq/hub.js`, 'GET', O)).toBeNull();
  expect(strategyFor(`${O}/q/abc`, 'GET', O)).toBeNull();
  expect(strategyFor('https://r2.example/x.mp3', 'GET', O)).toBeNull();
  expect(CORE_FILES).toContain('play.html');
});

test('the session keeps its own language\'s clips, once each, under the base', () => {
  const ur = urls(MINI, 'ur', '/');
  const en = urls(MINI, 'en', '/');
  expect(ur.length).toBeGreaterThan(10);
  expect(ur.every((u) => u.startsWith('/sa/v1/ur/') && u.endsWith('.mp3'))).toBe(true);
  expect(new Set(ur).size).toBe(ur.length);
  // a two-language line gives only this session's language; an item's own clip (an Urdu letter's name) is kept as is
  const letters = MINI.tasks.find((t) => t.id === 'ur.letters');
  expect(en).toContain(`/${letters.instruction.audio.en}`);
  expect(en).not.toContain(`/${letters.instruction.audio.ur}`);
  expect(ur).not.toContain(`/${letters.instruction.audio.en}`);
  expect(ur).toContain(`/${letters.items[0].prompt_audio}`);
  expect(urls(MINI, 'ur', 'https://cdn.test/base')[0]).toMatch(/^https:\/\/cdn\.test\/base\/sa\/v1\/ur\//);
});

test('the worker keeps every local file play.html loads, and only files that exist', () => {
  const fs = require('fs');
  const path = require('path');
  const html = fs.readFileSync(path.join(__dirname, '../sa/play.html'), 'utf8');
  const local = [...html.matchAll(/(?:src|href)="\.\/([^"?#]+)"/g)].map((m) => m[1]);
  expect(local.length).toBeGreaterThan(3);
  for (const f of local) expect(CORE_FILES).toContain(f);
  for (const f of CORE_FILES) expect(fs.existsSync(path.join(__dirname, '../sa', f))).toBe(true);
});
