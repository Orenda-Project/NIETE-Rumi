/**
 * Three whole board-pattern papers (Maths, Urdu, Science) through the real
 * pure chain the engine will run: applyLayout → normaliseScheme → mathsCheck
 * → paper HTML → marking-scheme HTML. Every slot is filled, nothing is short,
 * the header total is 100, and the one planted wrong maths key (52.8 ÷ 1.2
 * written as 44.5) is corrected to 44 in the answer and the scheme.
 *
 * Pure: no browser, no network.
 */

const fs = require('fs');
const path = require('path');
const Patterns = require('../../bot/shared/services/assessment/patterns');
const { applyLayout } = require('../../bot/shared/services/assessment/fde-layout');
const { normaliseScheme } = require('../../bot/shared/services/assessment/marking-scheme');
const { mathsCheck } = require('../../bot/shared/services/assessment/maths-check');
const R = require('../../bot/shared/services/assessment/assessment-paper-fde.renderer');

const NOW = '2026-10-20T07:12:00.000Z';
const P = Patterns.get('fde_g5_2027');

function chain(name) {
  const raw = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'fde', `${name}.json`), 'utf8'));
  const laid = applyLayout(raw, P.subjects[name], { kind: 'fde' }, { now: NOW });
  const ns = normaliseScheme(laid.examJson);
  const mc = mathsCheck(ns.examJson, { subject: name });
  const exam = mc.examJson;
  const paper = R.renderPaper({ examJson: exam, grade: 5, subject: name, answerLines: true });
  const scheme = R.renderMarkingScheme({ examJson: exam, grade: 5, subject: name });
  return { laid, ns, mc, exam, paper, scheme };
}

const PLACED = { maths: 48, urdu: 35, science: 41 };

describe.each(Object.keys(PLACED))('the %s fixture through the whole chain', (name) => {
  const run = chain(name);

  it('places every item, leaves no slot short and the scheme complete', () => {
    expect(run.laid.placed).toBe(PLACED[name]);
    expect(run.laid.unplaced).toBe(0);
    expect(run.laid.shortfall).toEqual([]);
    expect(run.ns.shortfall).toEqual([]);
  });

  it('prints a paper and a scheme whose total is 100', () => {
    expect(R.totalMarks(run.exam)).toBe(100);
    expect(run.paper).toMatch(/^<!DOCTYPE html>/);
    expect(run.scheme).toMatch(/^<!DOCTYPE html>/);
    expect(run.scheme).toContain('class="record"');
  });
});

describe('the maths fixture key check', () => {
  it('corrects the one planted wrong key, in the answer and the scheme', () => {
    const { mc, scheme } = chain('maths');
    expect(mc.replaced).toBe(1);
    expect(scheme).toMatch(/key corrected by code; the model wrote 44\.5/);
  });
});
