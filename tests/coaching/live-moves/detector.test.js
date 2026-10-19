/**
 * Live moves (bd-v0toag.31): the move detector reads the last stretch of live transcript and names which unticked
 * moves the teacher has done. A failure never ticks anything.
 */
const { buildDetectPrompt, parseDetect } = require('../../../bot/shared/services/coaching/live-moves/detector-prompt');
const { detectMoves } = require('../../../bot/shared/services/coaching/live-moves/detector');

const moves = [
  { idx: 0, do: 'Show the picture of the market', say: 'What do you see here?' },
  { idx: 2, do: 'Model adding unlike fractions with the LCM', say: 'First we find the LCM of 4 and 3.' },
];

const clientAnswering = (impl) => ({ chat: { completions: { create: jest.fn(impl) } } });

test('parseDetect drops unknown and already-ticked indices', () => {
  const raw = JSON.stringify({ done: [{ idx: 0, confidence: 0.9 }, { idx: 1, confidence: 0.95 }, { idx: 7, confidence: 0.99 }, { idx: 2.5, confidence: 0.9 }] });
  expect(parseDetect(raw, [0, 2])).toEqual([0]);
});

test('parseDetect drops below cutoff', () => {
  const raw = JSON.stringify({ done: [{ idx: 0, confidence: 0.69 }, { idx: 2, confidence: 0.7 }] });
  expect(parseDetect(raw, [0, 2])).toEqual([2]);
});

test('parseDetect returns [] on junk', () => {
  expect(parseDetect('not json', [0, 2])).toEqual([]);
  expect(parseDetect('{"done":"yes"}', [0, 2])).toEqual([]);
  expect(parseDetect('', [0, 2])).toEqual([]);
});

test('detectMoves returns [] on timeout', async () => {
  const client = clientAnswering(() => new Promise(() => {}));
  const log = jest.fn();
  const done = await detectMoves({ window: 'آج ہم کسر جمع کریں گے', moves }, { client, log, timeoutMs: 10 });
  expect(done).toEqual([]);
  expect(log).toHaveBeenCalledWith('live_moves.detect.failed', expect.objectContaining({ reason: 'timeout' }));
});

test('detectMoves sends the fidelity model with the live-moves job name', async () => {
  const client = clientAnswering(async () => ({ choices: [{ message: { content: '{"done":[{"idx":2,"confidence":0.8}]}' } }] }));
  const done = await detectMoves({ window: 'پہلے 4 اور 3 کا ذو اضعاف اقل نکالیں', moves }, { client, log: jest.fn() });
  expect(done).toEqual([2]);
  expect(client.chat.completions.create).toHaveBeenCalledWith(expect.objectContaining({
    job: 'live_moves.detect', temperature: 0, response_format: { type: 'json_object' },
  }));
});

test("prompt carries every unticked move's do and say", () => {
  const { system, user } = buildDetectPrompt({ window: 'transcript text', moves });
  for (const m of moves) {
    expect(user).toContain(m.do);
    expect(user).toContain(m.say);
    expect(user).toContain(`"idx": ${m.idx}`);
  }
  expect(user).toContain('transcript text');
  expect(system).toContain('"done"');
  expect(system).toMatch(/Urdu/);
});

test('no model call for empty window', async () => {
  const client = clientAnswering(async () => ({ choices: [] }));
  expect(await detectMoves({ window: '   ', moves }, { client, log: jest.fn() })).toEqual([]);
  expect(await detectMoves({ window: 'words', moves: [] }, { client, log: jest.fn() })).toEqual([]);
  expect(client.chat.completions.create).not.toHaveBeenCalled();
});
