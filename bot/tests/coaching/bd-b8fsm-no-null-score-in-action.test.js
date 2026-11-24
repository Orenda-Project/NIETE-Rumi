// bd-b8fsm: a teacher read "currently null/4" (Urdu: "فی الحال null/4") in her debrief.
// The domains path (FICO) skips an unscored row since 2026-09-03; the HOTS and Teach
// paths did not, so an unscored row there still became the "weakest" focus and its
// null was printed into the action line.

jest.mock('../../shared/utils/logger', () => ({ logToFile: jest.fn() }));

const {
  extractIndicators,
  generatePrioritizedAction,
} = require('../../shared/services/coaching/coaching-card/prioritized-action.service');

const hots = {
  areas: {
    questioning: {
      indicators: [
        { id: 'H1', name: 'Open questions', score: null },
        { id: 'H2', name: 'Wait time', score: 2 },
      ],
    },
  },
};

const teach = {
  areas: {
    culture: {
      elements: [
        { id: 1, name: 'Supportive learning', holistic_score: undefined },
        { id: 2, name: 'Positive behaviour', holistic_score: 3 },
      ],
    },
  },
};

describe('bd-b8fsm: an unscored indicator never reaches the teacher as "null"', () => {
  test('HOTS: an unscored indicator is not a candidate', () => {
    expect(extractIndicators(hots).map((i) => i.id)).toEqual(['H2']);
  });

  test('Teach: an unscored element is not a candidate', () => {
    expect(extractIndicators(teach).map((i) => i.id)).toEqual(['E2']);
  });

  test.each([['HOTS', hots], ['Teach', teach]])('%s: the action line names a real score', async (_n, analysis) => {
    const out = await generatePrioritizedAction(analysis, 'Teacher');
    expect(out).not.toBeNull();
    expect(out.action).not.toMatch(/null|undefined|NaN/);
  });
});
