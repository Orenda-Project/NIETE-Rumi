/**
 * The visit planner's Start says which flow armed the recording: /observe2 (its token carries the
 * observe2-visit marker) or classic /observe. A capture then links an /observe2 form only for an
 * /observe2 Start, and a state armed before this change (no origin) keeps the old lookup
 * (review, 4 Oct: inferring "classic" from a missing form id stranded forms started before a deploy
 * or whose form id was never written).
 *
 * Real: the visit handler's bind. Mocked: the roster lookup, the observe state, the logger.
 */
jest.mock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn(), logWarn: jest.fn(), logError: jest.fn() }));
jest.mock('../../bot/shared/services/observe/observe-state.service', () => ({
  getState: jest.fn(() => Promise.resolve(null)),
  setState: jest.fn(() => Promise.resolve(true)),
  clearState: jest.fn(() => Promise.resolve(true)),
}));
jest.mock('../../bot/shared/services/observe/assignment/leader-source', () => ({
  resolveTeacher: jest.fn(() => Promise.resolve({ user_id: 'teacher-1', teacher_ext_id: 'tx1', teacher_name: 'Rabia', phone_e164: '923000000002' })),
}));

const ObserveState = require('../../bot/shared/services/observe/observe-state.service');
const VisitHandler = require('../../bot/shared/handlers/observe-visit-flow.handler');

const COACH = { id: 'coach-1', role: 'coach', preferred_language: 'en' };
const START = { step: 'start', teacher_ext_id: 'tx1', school_ext_id: 'sx1' };

beforeEach(() => jest.clearAllMocks());

test.each([
  ['coach-1:observe2-visit', 'observe2'],
  ['coach-1', 'observe'],
])('a Start from the planner opened with %s arms the recording with origin %s', async (token, origin) => {
  await VisitHandler.handle('coach-1', 'complete', 'BRIEF', START, token, COACH);
  expect(ObserveState.setState).toHaveBeenCalledWith('coach-1', 'awaiting_audio', expect.objectContaining({
    origin, boundTeacher: expect.objectContaining({ user_id: 'teacher-1' }),
  }));
});
