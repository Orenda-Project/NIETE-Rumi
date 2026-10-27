/**
 * G2 GK Q9 is "label the plant" (bd-5jmnfj.4.33).
 *
 * The arrows came off every picture (#3616) and Q9 still asked "which part is the
 * arrow pointing to?". Amena, 23 Oct 2026: "label the plant": one plant with
 * blank lines next to its parts, no arrows. The paper draws the plant itself, so
 * the blanks always sit beside the root, stem and leaf.
 */

const Svg = require('../../bot/shared/services/assessment/fde-picture-svg');
const Patterns = require('../../bot/shared/services/assessment/patterns');
const Prompt = require('../../bot/shared/services/assessment/fde-early-prompt');
const Block = require('../../bot/shared/services/assessment/fde-picture-block');
const R = require('../../bot/shared/services/assessment/assessment-paper-fde.renderer');
const gk = require('./fixtures/early/g1-general_knowledge-exam.json');

const gkPattern = Patterns.get('fde_g2_2026').subjects.general_knowledge;
const q9 = gkPattern.sections.flatMap((s) => s.slots).find((s) => s.slot === 'g2.general_knowledge.B.Q9');

describe('the plant picture', () => {
  const svg = Svg.svgFor({ kind: 'plant' });

  test('is drawn in place, as SVG', () => {
    expect(Svg.SVG_KINDS).toContain('plant');
    expect(svg.startsWith('<svg')).toBe(true);
  });

  test('has one blank line beside each of leaf, stem and root, top to bottom', () => {
    const blanks = [...svg.matchAll(/data-blank="(\w+)"[^>]*y1="([\d.]+)"/g)].map((m) => [m[1], Number(m[2])]);
    expect(blanks.map((b) => b[0])).toEqual(['leaf', 'stem', 'root']);
    expect(blanks[0][1]).toBeLessThan(blanks[1][1]);
    expect(blanks[1][1]).toBeLessThan(blanks[2][1]);
  });

  test('carries no arrowhead and no words', () => {
    expect(svg).not.toMatch(/<marker|marker-end|<polygon|<text/);
  });

  test('is black on white', () => {
    const colours = [...svg.matchAll(/(?:stroke|fill)="([^"]+)"/g)].map((m) => m[1]);
    colours.forEach((c) => expect(['#000', 'none']).toContain(c));
  });
});

describe('the Q9 slot', () => {
  test('is one 3-mark item that draws the plant, so the paper still totals 50', () => {
    expect(q9).toMatchObject({ generate: 1, marks_each: 3, picture: ['plant'], lines: 0 });
    const total = gkPattern.sections.flatMap((s) => s.slots).reduce((n, s) => n + s.attempt * s.marks_each, 0);
    expect(total).toBe(50);
  });

  test('never mentions an arrow, and gives the answer top to bottom', () => {
    expect(`${q9.prompt_rule} ${q9.instruction_ur}`).not.toMatch(/arrow|تیر/i);
    expect(q9.prompt_rule).toContain('پتا، تنا، جڑ');
  });

  test('a plant picture needs no fields from the writer', () => {
    const paper = { unseen: { subjective: { 'Parts of a Plant': [{ slot: q9.slot, question: 'q', picture: { kind: 'plant' } }] } } };
    expect(Prompt.pictureShortfall(paper, gkPattern)).toEqual([]);
  });
});

describe('the printed item', () => {
  test('prints the plant big enough to write on, with no write box under it', () => {
    const exam = JSON.parse(JSON.stringify(gk));
    exam.unseen.subjective['Wild or Domestic'].forEach((q) => { q.picture = { kind: 'plant', src: 'data:image/svg+xml;base64,AAAA' }; });
    const html = R.renderPaper({ examJson: exam, grade: 1, subject: 'general_knowledge' });
    const items = html.split('<div class="q').slice(1).filter((s) => s.includes('data-slot="g1.general_knowledge.B.Q9"'));
    expect(items.length).toBeGreaterThan(0);
    items.forEach((it) => {
      expect(it).toContain('pic-plant');
      expect(it).not.toContain('write-box');
    });
    expect(Block.PICTURE_CSS).toMatch(/\.pic-plant img \{ height: \d+mm/);
  });
});
