/**
 * bd-rlxkkt.1 — the rubric-shaped debrief notes, end to end through startDebrief: the model's notes
 * reach the coach as written (not the fallback), and a moment time the observation data does not
 * hold is dropped before the coach sees it (the model is told never to invent one; this is the check).
 */

jest.mock('../../shared/services/whatsapp.service', () => ({
  sendMessage: jest.fn().mockResolvedValue(true),
}));
jest.mock('../../shared/services/observe/observe-state.service', () => ({
  setState: jest.fn().mockResolvedValue(true),
  getState: jest.fn().mockResolvedValue(null),
  clearState: jest.fn().mockResolvedValue(true),
}));
jest.mock('../../shared/services/gpt5-mini.service', () => ({
  completeJson: jest.fn(),
}));

const mockSingle = jest.fn();
function mockMakeChain() {
  const chain = {};
  for (const m of ['select', 'eq', 'neq', 'order']) chain[m] = jest.fn(() => chain);
  chain.single = mockSingle;
  chain.limit = jest.fn().mockResolvedValue({ data: [], error: null });
  return chain;
}
jest.mock('../../shared/config/supabase', () => ({
  from: jest.fn(() => mockMakeChain()),
}));

const WhatsAppService = require('../../shared/services/whatsapp.service');
const ObserveState = require('../../shared/services/observe/observe-state.service');
const GPT5MiniService = require('../../shared/services/gpt5-mini.service');
const { startDebrief } = require('../../shared/services/observe/observe-debrief.service');

const SID = 'sess-rubric';
const FO = { id: 'fo-uuid-9', preferred_language: 'en' };
const FROM = '920000000009';

const sessionRow = () => ({
  id: SID,
  observer_user_id: 'fo-uuid-9',
  observation_type: 'leader_observation',
  status: 'observer_review_complete',
  debrief_status: 'pending',
  analysis_data: {
    framework: 'fico',
    strengths: [{ title: 'Pair work', evidence: 'every child answered in pairs' }],
    focus_area: { title: 'Asking why', try_this_tomorrow: 'add a why after a right answer', lever_question: 'What were you hoping for?' },
    notable_moments: [{ timestamp: '12:40', quote: 'Is this common or proper?' }],
  },
});

const modelNotes = (time) => ({
  intro: 'Notes for your talk.',
  went_well: ['Pair work: every child answered in pairs.'],
  work_on_first: { title: 'Asking why', seen: 'most questions were closed.', next_step: 'add a why after a right answer.' },
  moment: { time, text: 'You asked "Is this common or proper?" and moved on after one word.' },
  conversation: [
    'I liked how every child answered in pairs.',
    'There is a moment I would like to look at, when you asked "Is this common or proper?"',
    'What were you hoping for at that point?',
    'If we work on one thing: a why after a right answer.',
    'What will you try next time, in your own words?',
    'Say it to me now, as you will in class.',
  ],
  outro: 'No number to hand over.',
});

beforeEach(() => {
  jest.clearAllMocks();
  mockSingle.mockResolvedValue({ data: sessionRow(), error: null });
});

const sent = () => WhatsAppService.sendMessage.mock.calls.map((c) => c[1]).join('\n');
const armedGuide = () => ObserveState.setState.mock.calls.find((c) => c[1] === 'awaiting_debrief_audio')[2].guide_snapshot;

test("the model's rubric-shaped notes reach the coach, six numbered lines", async () => {
  GPT5MiniService.completeJson.mockResolvedValue({ result: modelNotes('12:40') });
  await startDebrief(SID, FROM, FO);
  const out = sent();
  expect(out).toContain('every child answered in pairs');
  expect(out).toContain('6. "Say it to me now, as you will in class."');
  expect(out).not.toContain('Your conversation guide — about 15 minutes');   // not the fallback
  expect(armedGuide().conversation).toHaveLength(6);
});

test('a moment time the data holds is kept', async () => {
  GPT5MiniService.completeJson.mockResolvedValue({ result: modelNotes('12:40') });
  await startDebrief(SID, FROM, FO);
  expect(sent()).toContain('(12:40)');
  expect(armedGuide().moment.time).toBe('12:40');
});

test('an invented moment time is dropped before the coach sees it', async () => {
  GPT5MiniService.completeJson.mockResolvedValue({ result: modelNotes('17:25') });
  await startDebrief(SID, FROM, FO);
  expect(sent()).not.toContain('17:25');
  expect(sent()).toContain('moved on after one word');           // the moment itself stays
  expect(armedGuide().moment.time).toBeNull();
});
