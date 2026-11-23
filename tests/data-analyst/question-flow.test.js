'use strict';
/**
 * The question Flow "data" opens (the operator, 21 Nov): one text box and four quick picks, static
 * (no endpoint), its reply carrying the typed question and the pick. Its picks are the door's own
 * QUICK_PICKS, so the Flow and the no-Flow list can never offer different questions.
 */

const path = require('path');
const FLOW = require('../../docs/flows/data-question.json');
const { QUICK_PICKS } = require('../../bot/shared/services/data-analyst/entry');
const { FLOW_CONFIGS } = require('../../bot/scripts/setup/flow-configs');

const screen = FLOW.screens.find((s) => s.id === 'DATA_QUESTION');
const children = screen && screen.layout.children.find((c) => c.type === 'Form').children;
const find = (type) => children.find((c) => c.type === type);

test('one screen, a text box and a radio group of the four quick picks, ending the Flow', () => {
  expect(screen).toBeTruthy();
  expect(screen.terminal).toBe(true);
  expect(find('TextArea').name).toBe('question');
  const radios = find('RadioButtonsGroup');
  expect(radios.name).toBe('pick');
  expect(radios['data-source']).toEqual(QUICK_PICKS.map((p) => ({ id: p.id, title: p.title })));
  for (const p of QUICK_PICKS) expect([...p.title].length).toBeLessThanOrEqual(30);
});

test('the footer completes with the typed question and the pick', () => {
  const footer = find('Footer');
  expect(footer['on-click-action'].name).toBe('complete');
  expect(footer['on-click-action'].payload).toEqual({ question: '${form.question}', pick: '${form.pick}' });
});

test('registered like every other Flow: a navigate config writing DATA_ANALYST_FLOW_ID', () => {
  const cfg = FLOW_CONFIGS.find((c) => c.envVar === 'DATA_ANALYST_FLOW_ID');
  expect(cfg).toBeTruthy();
  expect(cfg.type).toBe('navigate');
  expect(path.basename(cfg.jsonPath)).toBe('data-question.json');
});
