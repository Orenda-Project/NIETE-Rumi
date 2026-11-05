/**
 * The paper renderer routes a board paper (`_layout.profile === 'board'`) to the G6-12 renderers, and an FDE
 * board-pattern paper still to the FDE renderer (bd-5jmnfj.38.24).
 */
const mockFdePaper = jest.fn(() => 'FDE-PAPER');
const mockFdeScheme = jest.fn(() => 'FDE-SCHEME');
const mockBoardPaper = jest.fn(() => 'BOARD-PAPER');
const mockBoardScheme = jest.fn(() => 'BOARD-SCHEME');
jest.mock('../../../bot/shared/services/assessment/assessment-paper-fde.renderer', () => ({
  renderPaper: (...a) => mockFdePaper(...a), renderMarkingScheme: (...a) => mockFdeScheme(...a),
}));
jest.mock('../../../bot/shared/services/assessment/assessment-paper-board.renderer', () => ({ renderBoardPaper: (...a) => mockBoardPaper(...a) }));
jest.mock('../../../bot/shared/services/assessment/assessment-scheme-board.renderer', () => ({ renderBoardScheme: (...a) => mockBoardScheme(...a) }));

const R = require('../../../bot/shared/services/assessment/assessment-paper.renderer');

const board = { examJson: { _layout: { profile: 'board', sections: [] } }, grade: 9, subject: 'physics' };
const fde = { examJson: { _layout: { pattern: 'fde_g5_2027' } }, grade: 5, subject: 'english' };

beforeEach(() => jest.clearAllMocks());

test('a board paper prints with the board paper renderer, given the exam', () => {
  expect(R.renderPaper(board)).toBe('BOARD-PAPER');
  expect(mockBoardPaper).toHaveBeenCalledWith(board.examJson);
  expect(mockFdePaper).not.toHaveBeenCalled();
});

test('a board paper key is the board marking scheme', () => {
  expect(R.renderAnswerKey(board)).toBe('BOARD-SCHEME');
  expect(mockBoardScheme).toHaveBeenCalledWith(board.examJson);
  expect(mockFdeScheme).not.toHaveBeenCalled();
});

test('an FDE pattern paper still prints with the FDE renderer', () => {
  expect(R.renderPaper(fde)).toBe('FDE-PAPER');
  expect(R.renderAnswerKey(fde)).toBe('FDE-SCHEME');
  expect(mockBoardPaper).not.toHaveBeenCalled();
  expect(mockBoardScheme).not.toHaveBeenCalled();
});
