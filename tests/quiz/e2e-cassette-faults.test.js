'use strict';
/**
 * The mock lane can SCRIPT a vendor answer: E2E_CASSETTE_FAULTS names a JSON
 * file of rules, and a request whose normalised text matches a rule gets the
 * scripted reply (or throw) instead of the cassette or the live vendor, `times`
 * times. This is how a scenario forces "the model gave no usable reply" or
 * "the author never passed the checks" without a real model fault. Off with
 * the cassette (mode off), never recorded, and a rule that ran out is gone.
 * Executed against the real cassette module with the filesystem as the boundary.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');

jest.mock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn() }));

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cassette-faults-'));
const FAULTS = path.join(tmp, 'faults.json');
const DIR = path.join(tmp, 'cassettes');

function req(text) { return { model: 'm', messages: [{ role: 'user', content: text }] }; }
function fresh() { jest.resetModules(); return require('../../bot/shared/services/e2e-cassette'); }

beforeEach(() => {
  process.env.E2E_CASSETTE = 'replay';
  process.env.E2E_CASSETTE_DIR = DIR;
  process.env.E2E_CASSETTE_FAULTS = FAULTS;
  process.env.SUPABASE_URL = 'https://olvritwoqujtjvwfulbh.supabase.co';
  fs.rmSync(DIR, { recursive: true, force: true });
  fs.rmSync(FAULTS, { force: true });
});

test('a matching rule answers instead of the vendor, `times` times, and is never recorded', async () => {
  fs.writeFileSync(FAULTS, JSON.stringify([{ kind: 'llm', match: 'You are writing a short WhatsApp quiz', times: 2, content: '' }]));
  const c = fresh();
  const live = jest.fn(async () => ({ choices: [{ message: { content: 'LIVE' } }] }));
  const a = await c.wrap('llm', req('You are writing a short WhatsApp quiz for the children'), live);
  const b = await c.wrap('llm', req('You are writing a short WhatsApp quiz for the children'), live);
  expect(live).not.toHaveBeenCalled();
  expect(a.choices[0].message.content).toBe('');
  expect(b.choices[0].message.content).toBe('');
  expect(fs.existsSync(DIR) ? fs.readdirSync(DIR) : []).toEqual([]);          // nothing stored
  const third = await c.wrap('llm', req('You are writing a short WhatsApp quiz for the children'), live);
  expect(live).toHaveBeenCalledTimes(1);                                       // rule exhausted → live
  expect(third.choices[0].message.content).toBe('LIVE');
  expect(JSON.parse(fs.readFileSync(FAULTS, 'utf8'))).toEqual([]);            // the spent rule is gone
});

test('a request that matches no rule goes to the vendor; a `throw` rule throws its message', async () => {
  fs.writeFileSync(FAULTS, JSON.stringify([{ kind: 'llm', match: 'SOLVING a short quiz', times: 1, throw: 'scripted outage' }]));
  const c = fresh();
  const live = jest.fn(async () => ({ choices: [{ message: { content: 'LIVE' } }] }));
  const ok = await c.wrap('llm', req('You are reading the transcript of ONE real classroom lesson'), live);
  expect(ok.choices[0].message.content).toBe('LIVE');
  await expect(c.wrap('llm', req('You are SOLVING a short quiz for children'), live)).rejects.toThrow('scripted outage');
});

test('with the cassette off, rules are ignored', async () => {
  fs.writeFileSync(FAULTS, JSON.stringify([{ kind: 'llm', match: 'quiz', times: 5, content: '' }]));
  process.env.E2E_CASSETTE = 'off';
  const c = fresh();
  const live = jest.fn(async () => 'LIVE');
  expect(await c.wrap('llm', req('quiz'), live)).toBe('LIVE');
});

// ── the audit's cases: a bad file, a bad rule, a bad regex, a kind-less rule ──────────────
test('a malformed faults file is ignored loudly and the vendor is called', async () => {
  fs.writeFileSync(FAULTS, '{not json');
  const c = fresh(); const { logToFile } = require('../../bot/shared/utils/logger');
  const live = jest.fn(async () => 'LIVE');
  expect(await c.wrap('llm', req('quiz'), live)).toBe('LIVE');
  expect(logToFile.mock.calls.some((k) => /not JSON/.test(k[0]) && k[2] === 'warn')).toBe(true);
});
test('a rule without times, without kind, or with a broken regex is rejected with a warning and never deleted the others', async () => {
  fs.writeFileSync(FAULTS, JSON.stringify([
    { kind: 'llm', match: 'quiz', content: '' },                    // no times
    { match: 'quiz', times: 2, content: '' },                       // no kind
    { kind: 'llm', match: '/quiz(/', times: 2, content: '' },       // bad regex
    { kind: 'llm', match: 'quiz', times: 1, content: 'scripted' },  // the good one
  ]));
  const c = fresh(); const { logToFile } = require('../../bot/shared/utils/logger');
  const live = jest.fn(async () => ({ choices: [{ message: { content: 'LIVE' } }] }));
  const a = await c.wrap('llm', req('a quiz please'), live);
  expect(a.choices[0].message.content).toBe('scripted');
  expect(live).not.toHaveBeenCalled();
  expect(logToFile.mock.calls.filter((k) => /fault rule (ignored|has an invalid)/.test(k[0]) && k[2] === 'warn').length).toBe(3);
  const left = JSON.parse(fs.readFileSync(FAULTS, 'utf8'));
  expect(left.length).toBe(3);                                       // the spent good rule is gone; the rejected ones are not silently dropped
});
test('a rule for another kind never answers this kind', async () => {
  fs.writeFileSync(FAULTS, JSON.stringify([{ kind: 'llm', match: 'audio', times: 1, content: '' }]));
  const c = fresh();
  const live = jest.fn(async () => 'TRANSCRIPT');
  expect(await c.wrap('asr', { audio: 'audio bytes' }, live)).toBe('TRANSCRIPT');
});
