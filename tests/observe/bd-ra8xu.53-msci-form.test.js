'use strict';
/**
 * bd-ra8xu.53 — the FDE Maths & Science form (the one tool for both subjects), as Rifat asked on 13 Nov 23:10 PKT:
 *   (1) "indicators ka discription complete nhi aa rha": each indicator's FDE text and each level's FDE text sat
 *       inside the radio group (group description, option descriptions up to 202 characters), where WhatsApp cuts
 *       long text. They now stand in full above the radios; the radios carry only "Level 0" … "Level 3".
 *   (2) "back ka arrow nhi hy": Meta allows only forward routes, so going back is the header arrow; every screen
 *       after the first says so, and the last screen still lists every level chosen before Submit.
 *   (3) the development plan is FDE's own table (Annexure G p.14: Development area, Current level, Teacher goal,
 *       Action plan for the teacher); the form now says where it comes from.
 *   (4) an overview screen opens the form, as the English & Urdu form opens its sections.
 */

const F = require('../../bot/shared/services/observe/obs612/flow');
const O = require('../../bot/shared/services/coaching/frameworks/obs612');

const flow = F.buildFlow();
const screens = Object.fromEntries(flow.screens.map((s) => [s.id, s]));
const kids = (id) => screens[id].layout.children[0].children;
const texts = (id) => kids(id).filter((c) => c.type === 'TextBody' || c.type === 'TextCaption').map((c) => c.text);
const MSCI = O.TOOLS.msci;

describe('the Maths & Science form', () => {
  test('(4) opens on an overview of its parts, like the English & Urdu form', () => {
    expect(F.firstScreenOf('msci')).toBe('MSCI_OVERVIEW');
    expect(F.pathFor('msci', null)).toEqual(['MSCI_OVERVIEW', 'MSCI_BEFORE', 'MSCI_DURING_ONE', 'MSCI_DURING_TWO', 'MSCI_AFTER', 'MSCI_PLAN']);
    const ov = kids('MSCI_OVERVIEW');
    expect(ov.filter((c) => /RadioButtonsGroup|TextArea|TextInput|Dropdown/.test(c.type))).toEqual([]);
    const all = texts('MSCI_OVERVIEW').join('\n');
    for (const i of MSCI.indicators) expect(all).toContain(`${i.n}. ${O.SHORT.msci[i.key]}`);
    for (const stage of ['Before the lesson', 'During the lesson', 'After the lesson']) expect(all).toContain(stage);
    expect(all).toContain(MSCI.student_check.title);
    for (const c of MSCI.development_plan.columns) expect(all).toContain(c);
    expect(ov.find((c) => c.type === 'Footer').label).toBe('Start');
  });

  test('(1) every indicator and every level is shown in FDE\'s full words, above the radios', () => {
    for (const ind of MSCI.indicators) {
      const id = F.pathFor('msci', null).find((s) => F.fieldsOf(s).some((f) => f.name === ind.key));
      const shown = texts(id).join('\n');
      expect(shown).toContain(ind.text);
      ind.levels.forEach((l, n) => expect(shown).toContain(`Level ${n}: ${l}`));
      const radio = kids(id).find((c) => c.type === 'RadioButtonsGroup' && c.name === ind.key);
      expect(radio.description).toBeUndefined();
      expect(radio['data-source'].map((o) => o.title)).toEqual(['Level 0', 'Level 1', 'Level 2', 'Level 3']);
      expect(radio['data-source'].every((o) => o.description === undefined)).toBe(true);
      // the text sits right above its own radio group
      const at = kids(id).indexOf(radio);
      expect(kids(id)[at - 1].text).toContain(`Level 3: ${ind.levels[3]}`);
    }
  });

  test('(1) the 5-student check too', () => {
    const shown = texts('MSCI_PLAN').join('\n');
    expect(shown).toContain(MSCI.student_check.instruction);
    MSCI.student_check.levels.forEach((l, n) => expect(shown).toContain(`Level ${n}: ${l}`));
    const radio = kids('MSCI_PLAN').find((c) => c.name === MSCI.student_check.key);
    expect(radio['data-source'].every((o) => o.description === undefined)).toBe(true);
  });

  test('(2) every screen after the overview says how to go back; the last still lists the levels chosen', () => {
    for (const id of F.pathFor('msci', null).slice(1)) {
      expect(texts(id).join('\n')).toMatch(/← at the top/);
    }
    expect(F.bodiesOf('MSCI_PLAN')).toContain('levels_line');
  });

  test('(3) the development plan names FDE\'s table and where it is printed', () => {
    const shown = texts('MSCI_PLAN').join('\n');
    expect(shown).toMatch(/Annexure G, p\.14/);
    for (const c of MSCI.development_plan.columns) expect(shown).toContain(c);
  });

  test('Meta\'s caps: at most 50 components a screen, text bodies within 4096', () => {
    for (const id of F.pathFor('msci', null)) {
      expect(kids(id).length).toBeLessThanOrEqual(50);
      for (const t of texts(id)) expect(t.length).toBeLessThanOrEqual(4096);
    }
  });
});
