/**
 * _writePatternPaper sends a G6-12 board pattern to board-writer with the service's helpers, and nothing else
 * changes (bd-5jmnfj.38.24). The writer itself is mocked: it has its own suite (tests/assessment/board-writer).
 */
const mockWrite = jest.fn();
jest.mock('../../../bot/shared/services/assessment/board-writer', () => ({ writeBoardPaper: (...a) => mockWrite(...a) }));
jest.mock('../../../bot/shared/services/llm-client', () => ({ getClient: () => ({ chat: { completions: { create: jest.fn() } } }) }));
jest.mock('../../../bot/shared/utils/logger', () => ({ logToFile: jest.fn() }));

const Gen = require('../../../bot/shared/services/assessment/assessment-generation.service');
const Board = require('../../../bot/shared/services/assessment/patterns/board');

const RESULT = { examJson: { _layout: { profile: 'board' } }, questionCount: 3, tokenData: {}, sections: [], elapsedMs: 1 };

beforeEach(() => { mockWrite.mockReset(); mockWrite.mockResolvedValue(RESULT); });

describe('board dispatch', () => {
  test('a board id goes to writeBoardPaper with its subject entry and the args', async () => {
    const onSection = jest.fn();
    const out = await Gen.generatePatternExam({ grade: 9, subject: 'physics', pattern: 'fbise_ssc1_2027', chapterNumber: 3, onSection, requestId: 'r1' });
    expect(out).toBe(RESULT);
    expect(mockWrite).toHaveBeenCalledTimes(1);
    const [args, d] = mockWrite.mock.calls[0];
    expect(args).toMatchObject({ grade: 9, subject: 'physics', pattern: 'fbise_ssc1_2027', chapterNumber: 3, onSection, requestId: 'r1' });
    expect(args.P).toBe(Board.subjectOf('fbise_ssc1_2027', 'physics'));
    for (const k of ['resolveSubject', 'variantFor', 'assemble', 'stampSlo', 'sloList', 'loadPatternContent', 'patternModel',
      'resolveModelForJob', 'sectionMessages', 'writeSection', 'mergeSections', 'stripImageKeys', 'normaliseAnswers',
      'topUp', 'sumUsage', 'countQuestions', 'fail', 'logToFile']) {
      expect(typeof d[k]).toBe('function');
    }
    expect(typeof d.checks.run).toBe('function');
    expect(d.family).toBe('eng');
  });

  test('an Urdu board paper writes with the urdu family', async () => {
    await Gen.generatePatternExam({ grade: 9, subject: 'urdu', pattern: 'fbise_ssc1_2027' });
    expect(mockWrite.mock.calls[0][1].family).toBe('urdu');
  });

  test('a board id for the wrong grade or subject is refused, and the writer never runs', async () => {
    await expect(Gen.generatePatternExam({ grade: 10, subject: 'physics', pattern: 'fbise_ssc1_2027' })).rejects.toMatchObject({ code: 'PATTERN_INELIGIBLE' });
    await expect(Gen.generatePatternExam({ grade: 9, subject: 'art', pattern: 'fbise_ssc1_2027' })).rejects.toMatchObject({ code: 'PATTERN_INELIGIBLE' });
    expect(mockWrite).not.toHaveBeenCalled();
  });

  test('a board paper is written once even with splitRetry', async () => {
    await Gen.generatePatternExam({ splitRetry: true, grade: 9, subject: 'maths', pattern: 'fbise_ssc1_2027' });
    expect(mockWrite).toHaveBeenCalledTimes(1);
  });
});

describe('board deps', () => {
  const deps = async (subject = 'physics', grade = 9) => {
    await Gen.generatePatternExam({ grade, subject, pattern: 'fbise_ssc1_2027' });
    return mockWrite.mock.calls[mockWrite.mock.calls.length - 1][1];
  };

  test('variantFor resolves the subject entry for the grade', async () => {
    const d = await deps();
    const V = d.variantFor(Board.subjectOf('fbise_ssc1_2027', 'physics'), { grade: 9 });
    expect(V && Array.isArray(V.sections)).toBe(true);
  });

  test('resolveSubject returns the registry row', async () => {
    const d = await deps();
    expect(d.resolveSubject(9, 'physics')).toMatchObject({ code: 'physics' });
  });

  test('stampSlo sets tag.official_slo from the map (code wins over the model) and returns the item', async () => {
    const d = await deps();
    const item = { tag: { code: 'MADE-UP', chapter: 999, official_slo: 'model said' } };
    expect(d.stampSlo(9, 'physics', item)).toBe(item);
    expect(item.tag.official_slo).toBeNull();
    const plain = { q: 'x' };
    expect(d.stampSlo(9, 'physics', plain)).toBe(plain);
    expect(plain.tag).toBeUndefined();
  });

  test('sloList lists the official SLOs for a stamped cell, empty for none', async () => {
    const d = await deps();
    const list = d.sloList(9, 'physics');
    expect(typeof list).toBe('string');
    expect(list).toBe(require('../../../bot/shared/services/assessment/slo-map').listFor(9, 'physics'));
    expect(d.sloList(6, 'nosuch')).toBe('');
  });
});
