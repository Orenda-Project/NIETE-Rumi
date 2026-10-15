/**
 * One entry point, two printers.
 *
 * Every caller that prints a paper or its key — the build, a revision, the portal's re-render —
 * goes through `renderPaper` / `renderAnswerKey` in the old renderer. A board-pattern paper is
 * recognised by what it carries (`_layout`), never by a flag, so a paper made while the pattern
 * was switched on still prints with its sections after the switch goes off. A paper without
 * `_layout` must not notice the second printer exists: its HTML is the same, byte for byte.
 *
 * Pure: HTML strings, no browser.
 */

const fs = require('fs');
const path = require('path');

jest.mock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn(), logError: jest.fn() }));

const Patterns = require('../../bot/shared/services/assessment/patterns');
const { applyLayout } = require('../../bot/shared/services/assessment/fde-layout');
const { normaliseScheme } = require('../../bot/shared/services/assessment/marking-scheme');
const { mathsCheck } = require('../../bot/shared/services/assessment/maths-check');
const Renderer = require('../../bot/shared/services/assessment/assessment-paper.renderer');
const Fde = require('../../bot/shared/services/assessment/assessment-paper-fde.renderer');

const NOW = '2026-10-20T07:12:00.000Z';
const P = Patterns.get('fde_g5_2027');

function laidOut(name) {
  const raw = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'fde', `${name}.json`), 'utf8'));
  const laid = applyLayout(raw, P.subjects[name], { kind: 'fde' }, { now: NOW }).examJson;
  return mathsCheck(normaliseScheme(laid).examJson, { subject: name }).examJson;
}

describe('_layout paper goes to the FDE renderer', () => {
  test.each(['maths', 'urdu', 'science'])('%s: renderPaper prints the board paper', (name) => {
    const examJson = laidOut(name);
    const args = { examJson, grade: 5, subject: name, schoolName: null, pageReference: '1-40', chapterTitle: null, answerLines: true };
    expect(Renderer.renderPaper(args)).toBe(Fde.renderPaper(args));
  });

  test.each(['maths', 'urdu', 'science'])('%s: renderAnswerKey prints the marking scheme', (name) => {
    const examJson = laidOut(name);
    const args = { examJson, grade: 5, subject: name, schoolName: null, pageReference: '1-40', chapterTitle: null, paperFileName: 'Grade5_Maths_FDE.pdf' };
    const html = Renderer.renderAnswerKey(args);
    expect(html).toBe(Fde.renderMarkingScheme(args));
    expect(html).toContain('class="record"');
  });
});

describe('no _layout → today\'s HTML byte-identical', () => {
  const DIR = path.join(__dirname, 'fixtures', 'golden');
  test.each(['maths', 'science', 'urdu'])('%s paper and key never reach the FDE renderer', (name) => {
    const examJson = JSON.parse(fs.readFileSync(path.join(DIR, `exam.${name}.json`), 'utf8'));
    const spyPaper = jest.spyOn(Fde, 'renderPaper');
    const spyKey = jest.spyOn(Fde, 'renderMarkingScheme');
    const args = { examJson, grade: 5, subject: name, schoolName: 'A School', pageReference: '12-20', chapterTitle: 'Ch' };
    const paper = Renderer.renderPaper({ ...args, answerLines: true });
    const key = Renderer.renderAnswerKey(args);
    expect(spyPaper).not.toHaveBeenCalled();
    expect(spyKey).not.toHaveBeenCalled();
    // Today's printer: no board band, no class record, the old question list.
    expect(paper).not.toContain('data-section=');
    expect(key).not.toContain('class="record"');
    spyPaper.mockRestore();
    spyKey.mockRestore();
  });
});
