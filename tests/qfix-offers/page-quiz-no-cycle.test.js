/**
 * report-page-quiz.js requires the offer service at call time; nothing it reaches may require it back (bd-hw2nix).
 * The repo-wide audit (tests/setup/circular-deps.test.js) lists every cycle; this one names only ours, so it stays
 * red or green on this change alone. The page's no-send marker lives in quiz/page-no-send.js, which requires nothing.
 */
const path = require('path');
const { getGraph, ROOT } = require('../setup/_audit-helpers/require-graph');

const QUIZ = 'bot/shared/services/quiz';
const PAGE = path.resolve(ROOT, `${QUIZ}/report-page-quiz.js`);

describe('report-page-quiz is in no require cycle', () => {
  const graph = getGraph();

  test('no cycle contains report-page-quiz.js', () => {
    const ours = graph.findCycles().filter((scc) => scc.includes(PAGE)).map((scc) => scc.map((n) => n.replace(`${ROOT}/`, '')));
    expect(ours).toEqual([]);
  });

  test('the marker keeps its value, and report-page-quiz still exports it', () => {
    const { PAGE_NO_SEND } = require(`../../${QUIZ}/page-no-send`);
    expect(PAGE_NO_SEND).toBe('report_page:no_send');
    expect(require(`../../${QUIZ}/report-page-quiz`).PAGE_NO_SEND).toBe(PAGE_NO_SEND);
  });
});
