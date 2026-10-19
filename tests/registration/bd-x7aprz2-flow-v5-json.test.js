/**
 * bd-x7aprz.2 — the registration Flow v5 asset, checked before it goes anywhere near Meta.
 *
 * Meta's validator catches some of this on upload; it does not catch a label that fits in English
 * and overflows in Urdu, a ${data.x} the endpoint never sends, or a completion payload the chat ack
 * cannot recognise. Those are what this file pins. Caps are measured in CODE POINTS.
 */
const fs = require('fs');
const path = require('path');

jest.mock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn() }));

const FLOW_FILE = path.join(__dirname, '../../docs/flows/registration-flow-v5.json');
const cp = (s) => [...String(s)].length;
const flow = () => JSON.parse(fs.readFileSync(FLOW_FILE, 'utf8'));
const screens = () => Object.fromEntries(flow().screens.map((s) => [s.id, s]));

function walk(children, visit) {
  for (const c of children || []) {
    visit(c);
    if (c.children) walk(c.children, visit);
  }
}

describe('registration-flow-v5.json', () => {
  it('is the five v5 screens, forward-only, ending in a terminal SUCCESS', () => {
    const f = flow();
    expect(f.data_api_version).toBe('3.0');
    expect(f.screens.map((s) => s.id)).toEqual(['PERSONAL_INFO', 'ROLE_SCHOOL', 'SCHOOL_PICK', 'TEACHING', 'SUCCESS']);
    expect(f.routing_model).toEqual({
      PERSONAL_INFO: ['ROLE_SCHOOL'], ROLE_SCHOOL: ['SCHOOL_PICK'], SCHOOL_PICK: ['TEACHING'], TEACHING: ['SUCCESS'], SUCCESS: [],
    });
    expect(screens().SUCCESS.terminal).toBe(true);
  });

  it('asks no country, no organization and no free-text school', () => {
    const names = [];
    for (const s of flow().screens) walk(s.layout.children, (c) => { if (c.name) names.push(c.name); });
    expect(names).not.toEqual(expect.arrayContaining(['country']));
    expect(names).not.toContain('organization');
    expect(names).not.toContain('school_name');
    expect(names).not.toContain('emis_code');
  });

  it('every ${data.x} a screen binds is declared on that screen', () => {
    for (const s of flow().screens) {
      const declared = Object.keys(s.data || {});
      const used = new Set(JSON.stringify(s.layout).match(/\$\{data\.([a-z0-9_]+)\}/gi) || []);
      for (const u of used) expect(declared).toContain(u.slice(7, -1));
    }
  });

  it('every ${form.x} in a payload is a field of that form', () => {
    for (const s of flow().screens) {
      const fields = [];
      walk(s.layout.children, (c) => { if (c.name && c.type !== 'Form') fields.push(c.name); });
      const used = JSON.stringify(s.layout).match(/\$\{form\.([a-z0-9_]+)\}/gi) || [];
      for (const u of used) expect(fields).toContain(u.slice(7, -1));
    }
  });

  it('the completion payload is flat and names itself, so the chat ack can find it', () => {
    let footer = null;
    walk(screens().SUCCESS.layout.children, (c) => { if (c.type === 'Footer') footer = c; });
    expect(footer['on-click-action'].name).toBe('complete');
    expect(footer['on-click-action'].payload.registration_action).toBe('${data.registration_action}');
    expect(footer['on-click-action'].payload.flow_token).toBe('${data.flow_token}');
  });

  it('the static first screen fits Meta caps (labels 20, heading 80)', () => {
    walk(screens().PERSONAL_INFO.layout.children, (c) => {
      if (c.type === 'TextInput' && !String(c.label).startsWith('${')) expect(cp(c.label)).toBeLessThanOrEqual(20);
      if (c.type === 'RadioButtonsGroup' && !String(c.label).startsWith('${')) expect(cp(c.label)).toBeLessThanOrEqual(30);
      if (c.type === 'TextHeading') expect(cp(c.text)).toBeLessThanOrEqual(80);
      if (c.type === 'Footer') expect(cp(c.label)).toBeLessThanOrEqual(35);
    });
  });
});

describe('the labels the endpoint serves fit, in both languages', () => {
  const { screenCopy } = require('../../bot/shared/routes/registration-endpoint');
  const CAPS = {
    t_role_label: 30, t_search_label: 20, t_search_help: 80, t_next: 35, t_search: 35, t_pick_label: 30,
    t_grades: 30, t_subjects: 30, t_finish: 35, t_done: 35, t_heading: 80,
  };
  for (const language of ['en', 'ur']) {
    for (const screen of ['ROLE_SCHOOL', 'SCHOOL_PICK', 'TEACHING', 'SUCCESS']) {
      it(`${screen} (${language})`, () => {
        const copy = screenCopy(screen, language, { query: 'IMSG G-7/2', name: 'Ayesha', count: 3 });
        for (const [k, v] of Object.entries(copy)) {
          if (Array.isArray(v)) {
            for (const opt of v) {
              expect(cp(opt.title)).toBeLessThanOrEqual(30);
              if (opt.description) expect(cp(opt.description)).toBeLessThanOrEqual(300);
            }
          } else if (CAPS[k]) {
            expect(cp(v)).toBeLessThanOrEqual(CAPS[k]);
          }
        }
      });
    }
  }
});
