'use strict';
/**
 * Registration Flow v6 (plan N3, section 3.1): v5.1 plus ONE screen, IS_THIS_YOU, between SCHOOL_PICK and TEACHING.
 * v6 marks its requests with form_rev "6" (SCHOOL_PICK, IS_THIS_YOU, TEACHING) so the endpoint can tell it from a v5.1
 * session still in flight, and SUCCESS declares the new `identity` param (an undeclared key is stripped). Apart from
 * those, v6 IS v5.1: v5.1 stays in the repo as the rollback asset.
 */
jest.mock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn(), logError: jest.fn(), logWarn: jest.fn() }));
jest.mock('../../bot/shared/services/cache/railway-redis.service', () => ({ get: jest.fn(), set: jest.fn() }));
jest.mock('../../bot/shared/config/supabase', () => ({ from: jest.fn() }));
jest.mock('../../bot/shared/services/whatsapp.service', () => ({}));
jest.mock('../../bot/shared/services/conversation-state.service', () => ({}));
jest.mock('../../bot/shared/services/reading/passage-generation.service', () => ({}));
jest.mock('../../bot/shared/services/reading/auto-level-orchestrator.service', () => ({}));

const fs = require('fs');
const path = require('path');

const DIR = path.join(__dirname, '../../docs/flows');
const load = (f) => JSON.parse(fs.readFileSync(path.join(DIR, f), 'utf8'));
const V6 = 'registration-flow-v6.json';
const screen = (d, id) => d.screens.find((s) => s.id === id);
const clone = (o) => JSON.parse(JSON.stringify(o));

function nodes(o, out = []) {
  if (Array.isArray(o)) o.forEach((x) => nodes(x, out));
  else if (o && typeof o === 'object') { out.push(o); Object.values(o).forEach((x) => nodes(x, out)); }
  return out;
}
const footerPayload = (s) => nodes(s.layout).find((n) => n['on-click-action'])['on-click-action'].payload;
function refs(s, kind) {
  const found = new Set();
  JSON.stringify(s.layout).replace(new RegExp(`\\$\\{${kind}\\.([A-Za-z0-9_]+)\\}`, 'g'), (_m, k) => found.add(k));
  return [...found];
}
const formFields = (s) => nodes(s.layout).filter((n) => n.name && n.type && n.type !== 'Form').map((n) => n.name);
function stripUnderscore(o) {
  if (Array.isArray(o)) return o.map(stripUnderscore);
  if (o && typeof o === 'object') {
    return Object.fromEntries(Object.entries(o).filter(([k]) => !k.startsWith('_')).map(([k, v]) => [k, stripUnderscore(v)]));
  }
  return o;
}

test('V1: the screens, in order, and forward-only routing through IS_THIS_YOU', () => {
  const d = load(V6);
  expect(d.screens.map((s) => s.id)).toEqual(['PERSONAL_INFO', 'ROLE_SCHOOL', 'SCHOOL_PICK', 'IS_THIS_YOU', 'TEACHING', 'SUCCESS']);
  expect(d.routing_model).toEqual({
    PERSONAL_INFO: ['ROLE_SCHOOL'], ROLE_SCHOOL: ['SCHOOL_PICK'], SCHOOL_PICK: ['IS_THIS_YOU', 'TEACHING'],
    IS_THIS_YOU: ['TEACHING'], TEACHING: ['SUCCESS'], SUCCESS: [],
  });
});

test('V2: every ${data.x} is declared on its screen and every ${form.x} is a field of its form', () => {
  const d = load(V6);
  for (const s of d.screens) {
    for (const k of refs(s, 'data')) expect([s.id, Object.keys(s.data || {}).includes(k) ? k : `undeclared:${k}`]).toEqual([s.id, k]);
    const fields = formFields(s);
    for (const k of refs(s, 'form')) expect([s.id, fields.includes(k) ? k : `no field:${k}`]).toEqual([s.id, k]);
  }
});

test('V3: SCHOOL_PICK, IS_THIS_YOU and TEACHING send form_rev "6"; the first two screens do not; IS_THIS_YOU pre-selects nothing', () => {
  const d = load(V6);
  for (const id of ['SCHOOL_PICK', 'IS_THIS_YOU', 'TEACHING']) expect(footerPayload(screen(d, id)).form_rev).toBe('6');
  for (const id of ['PERSONAL_INFO', 'ROLE_SCHOOL']) expect(footerPayload(screen(d, id))).not.toHaveProperty('form_rev');
  expect(JSON.stringify(screen(d, 'IS_THIS_YOU'))).not.toContain('init-value');
  expect(footerPayload(screen(d, 'IS_THIS_YOU'))).toEqual({ is_this_you: '${form.is_this_you}', form_rev: '6' });
});

test('V4: SUCCESS declares exactly the params the endpoint sends, identity included', () => {
  const emr = screen(load(V6), 'SUCCESS').data.extension_message_response;
  expect(Object.keys(emr.properties.params.properties).sort())
    .toEqual(['flow_token', 'full_name', 'identity', 'language', 'registration_action', 'school_linked']);
  expect(emr.__example__.params.identity).toBe('none');
});

test('V5: apart from IS_THIS_YOU, form_rev and identity, v6 is v5.1 exactly', () => {
  const back = clone(load(V6));
  back.screens = back.screens.filter((s) => s.id !== 'IS_THIS_YOU');
  back.routing_model.SCHOOL_PICK = ['TEACHING'];
  delete back.routing_model.IS_THIS_YOU;
  for (const s of back.screens) { const p = footerPayload(s); delete p.form_rev; }
  const emr = screen(back, 'SUCCESS').data.extension_message_response;
  delete emr.properties.params.properties.identity;
  delete emr.__example__.params.identity;
  expect(stripUnderscore(back)).toEqual(stripUnderscore(load('registration-flow-v5.1.json')));
});

test('V6: flow-configs registers v6 for Registration, and v5.1 stays in the repo as the rollback asset', () => {
  const { FLOW_CONFIGS } = require('../../bot/scripts/setup/flow-configs');
  const reg = FLOW_CONFIGS.find((c) => c.name === 'Registration');
  expect(path.basename(reg.jsonPath)).toBe(V6);
  expect(fs.existsSync(path.join(DIR, 'registration-flow-v5.1.json'))).toBe(true);
});

test('the endpoint\'s IS_THIS_YOU reply fills exactly the data the v6 screen declares', () => {
  const { screenCopy } = require('../../bot/shared/routes/registration-endpoint');
  const declared = Object.keys(screen(load(V6), 'IS_THIS_YOU').data).sort();
  for (const lang of ['en', 'ur']) {
    expect(Object.keys(screenCopy('IS_THIS_YOU', lang, { name: 'Ayesha', school: 'IMSG', last2: '47' })).sort()).toEqual(declared);
  }
});
