/**
 * bd-fjnrit — a drawn item (Label the Diagram, Mind Map, Flow Chart) never prints without its picture.
 *
 *   1. A seen-only paper's prompt carries the teacher's requested types (and so the drawing line
 *      the model needs to write a `diagram`), instead of "objective and subjective".
 *   2. A drawn item that ends up with no picture is dropped before the seen cap and the marks
 *      budget are measured, so the paper still meets its count and marks the way those paths do.
 */
const mockCreate = jest.fn();
jest.mock('../../bot/shared/services/llm-client', () => ({
  getClient: () => ({ chat: { completions: { create: mockCreate } } }),
}));
jest.mock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn() }));

const Gen = require('../../bot/shared/services/assessment/assessment-generation.service');
const D = require('../../bot/shared/services/assessment/paper-diagram');

const PAGE = '=== Page 4 ===\nThe plant cell has a wall.';
const TYPES = [
  { id: 'MCQs', count: 2, category: 'objective' },
  { id: 'Label the Diagram', count: 1, category: 'subjective' },
];
const SEEN = { grade: 5, subject: 'science', pageContent: PAGE, pageReference: '4', contentSource: 'seen', questionCount: 3 };

describe('seen-only prompt gets the requested types', () => {
  const seenLine = (p) => p.split('\n').find((l) => l.includes('Seen questions'));

  it('keeps the old seen line: the portal fills defaultMix types in, so they are not her request', () => {
    const mix = [{ id: 'MCQs', count: 4, category: 'objective' }, { id: 'Fill in the Blanks', count: 3, category: 'objective' },
      { id: 'True/False', count: 3, category: 'objective' }];
    const line = seenLine(Gen.buildUserPrompt({ ...SEEN, questionCount: 10, questionTypes: mix }));
    expect(line).toBe("• Seen questions — exactly 10, taken directly from the textbook's own exercises on these pages (objective and subjective)");
  });

  it('never contradicts itself: no per-type counts next to the seen total', () => {
    const line = seenLine(Gen.buildUserPrompt({ ...SEEN, questionCount: 10, questionTypes: TYPES }));
    expect(line).toContain('exactly 10');
    expect(line).not.toMatch(/\b2 MCQs|1 Label the Diagram|no other types/);
  });

  it('carries the diagram instruction for a drawn type', () => {
    const p = Gen.buildUserPrompt({ ...SEEN, questionTypes: TYPES });
    expect(p).toContain('For Label the Diagram: add `"diagram"');
  });

  it('is unchanged when no types were requested', () => {
    const p = Gen.buildUserPrompt({ ...SEEN, questionTypes: [] });
    expect(seenLine(p)).toBe("• Seen questions — exactly 3, taken directly from the textbook's own exercises on these pages (objective and subjective)");
  });
});

describe('dropUnpictured', () => {
  const good = { question: 'Label it.', marks: 2, diagram: { figure: 'plant_cell' } };
  const bad = { question: 'Label the diagram of a cell.', marks: 2 };

  it('drops a drawn item with no usable figure and keeps one that has it', () => {
    const tree = { seen: { subjective: { 'Label the Diagram': [bad, good] } } };
    expect(D.dropUnpictured(tree)).toBe(1);
    expect(tree.seen.subjective['Label the Diagram']).toEqual([good]);
  });

  it('drops an unknown figure and a Mind Map without branches', () => {
    const tree = { unseen: { objective: { MCQs: [{ question: 'kept' }] }, subjective: {
      'Label the Diagram': [{ question: 'x', diagram: { figure: 'nope' } }],
      'Mind Map': [{ question: 'y', diagram: { centre: '' } }],
    } } };
    expect(D.dropUnpictured(tree)).toBe(2);
  });

  it('leaves every other type alone, nested lists included', () => {
    const tree = { unseen: { objective: { MCQs: [{ question: 'q' }] }, subjective: { 'Long Question': { Essay: [{ question: 'e' }] } } } };
    expect(D.dropUnpictured(tree)).toBe(0);
    expect(tree.unseen.objective.MCQs).toHaveLength(1);
  });
});

describe('generateExam never prints a picture-less drawn item', () => {
  const reply = (o) => ({ choices: [{ message: { content: JSON.stringify(o) } }], usage: {} });

  it('drops it and the paper still returns the rest', async () => {
    mockCreate.mockReset();
    mockCreate.mockResolvedValue(reply({ seen: { objective: { MCQs: [{ question: 'a', marks: 1, answer: 'x' }] },
      subjective: { 'Label the Diagram': [{ question: 'Label the cell.', marks: 2, answer: 'k' }] } } }));
    const out = await Gen.generateExam({ ...SEEN, questionTypes: TYPES });
    expect(out.examJson.seen.subjective['Label the Diagram']).toEqual([]);
    expect(out.questionCount).toBe(1);
  });

  it('counts the survivors against the marks budget, not the dropped item', async () => {
    mockCreate.mockReset();
    mockCreate.mockResolvedValue(reply({ seen: { subjective: {
      'Label the Diagram': [{ question: 'Label.', marks: 5, answer: 'k' }],
      'Brief Answers': [{ question: 'Why?', marks: 2, answer: 'b' }, { question: 'How?', marks: 2, answer: 'c' }] } } }));
    const out = await Gen.generateExam({ ...SEEN, questionTypes: [{ id: 'Brief Answers', count: 2, category: 'subjective' }], totalMarks: 4 });
    expect(out.examJson.seen.subjective['Brief Answers']).toHaveLength(2);
    expect(out.marksRemoved).toBe(0);
  });
});

describe('all-dropped paper falls back to text (bd-fjnrit round 2, A)', () => {
  const reply = (o) => ({ choices: [{ message: { content: JSON.stringify(o) } }], usage: {} });

  it('dropUnpictured keeps a paper of only picture-less drawn items rather than empty it', () => {
    const tree = { unseen: { subjective: { 'Mind Map': [{ question: 'Make a mind map.', marks: 4 }] } } };
    expect(D.dropUnpictured(tree)).toBe(0);
    expect(tree.unseen.subjective['Mind Map']).toHaveLength(1);
  });

  it('generateExam returns the text paper, not NO_QUESTIONS', async () => {
    mockCreate.mockReset();
    mockCreate.mockResolvedValue(reply({ seen: { subjective: { 'Mind Map': [{ question: 'Make a mind map.', marks: 4, answer: 'a' }] } } }));
    const out = await Gen.generateExam({ ...SEEN, questionCount: 1, questionTypes: [{ id: 'Mind Map', count: 1, category: 'subjective' }] });
    expect(out.questionCount).toBe(1);
  });
});

describe('Flow / portal seenTypes carry the drawing line and keep her counts (D)', () => {
  const seenTypes = [{ id: 'MCQs', count: 1, category: 'objective' }, { id: 'Label the Diagram', count: 1, category: 'subjective' }];

  it('a seen-types plan with Label the Diagram gets the diagram instruction', () => {
    const p = Gen.buildUserPrompt({ ...SEEN, questionTypes: [], seenTypes });
    expect(p).toContain('For Label the Diagram: add `"diagram"');
  });

  it('a Mind Map in seenTypes alone gets its line too', () => {
    const p = Gen.buildUserPrompt({ ...SEEN, questionTypes: [], seenTypes: [{ id: 'Mind Map', count: 2, category: 'subjective' }] });
    expect(p).toContain('• For Mind Map: add');
  });
});

describe('loosely named drawn types (E)', () => {
  const bad = { question: 'Label it.', marks: 2 };

  it.each(['Label the diagram', 'Mind map', 'flow chart', 'Flow Charts'])('dropUnpictured drops a picture-less "%s"', (name) => {
    const tree = { seen: { subjective: { [name]: [bad], 'Brief Answers': [{ question: 'Why?' }] } } };
    expect(D.dropUnpictured(tree)).toBe(1);
    expect(tree.seen.subjective[name]).toEqual([]);
  });

  it('figureFor draws a loosely named type', () => {
    expect(D.figureFor('Label the diagram', { diagram: { figure: 'plant_cell' } })).not.toBeNull();
    expect(D.figureFor('Mind map', { diagram: { centre: 'Plant', branches: ['Root', ''] } })).not.toBeNull();
  });

  it('the renderer draws it instead of printing bare text', () => {
    const R = require('../../bot/shared/services/assessment/assessment-paper.renderer');
    const html = R.renderPaper({ grade: 5, subject: 'Science', schoolName: 'S', pageReference: '1', chapterTitle: 'C', answerLines: true,
      examJson: { unseen: { subjective: { 'Label the diagram': [{ question: 'Label it.', marks: 2, diagram: { figure: 'plant_cell' } }] } } } });
    expect(html).toContain('<svg');
  });
});
