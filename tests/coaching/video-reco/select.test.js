'use strict';
/**
 * bd-gzfdu9 — select.pick: ONE completeJson call on the bot's own LLM path, job coaching.videoReco.
 */
let S;
let completeJson;
beforeEach(() => {
  jest.resetModules();
  completeJson = jest.fn();
  jest.doMock('../../../bot/shared/services/gpt5-mini.service', () => ({ completeJson }));
  S = require('../../../bot/shared/services/coaching/video-reco/select');
});

test('calls completeJson once with job coaching.videoReco, 4000 tokens (gpt-5-mini reasons first), label videoReco', async () => {
  completeJson.mockResolvedValue({ result: { seg_id: '10-s1' }, usage: { prompt_tokens: 10 }, finishReason: 'stop' });
  const r = await S.pick({ prompt: 'Return JSON' });
  expect(completeJson).toHaveBeenCalledTimes(1);
  expect(completeJson).toHaveBeenCalledWith('Return JSON', { job: 'coaching.videoReco', maxTokens: 4000, label: 'videoReco' });
  expect(r).toEqual({ pick: { seg_id: '10-s1' }, usage: { prompt_tokens: 10 }, model: expect.any(String), truncated: false });
});

test('finish_reason length or an empty result → truncated:true (the engine stores none:llm_truncated, never validation)', async () => {
  completeJson.mockResolvedValueOnce({ result: {}, usage: {}, finishReason: 'length' });
  expect((await S.pick({ prompt: 'JSON' })).truncated).toBe(true);
  completeJson.mockResolvedValueOnce({ result: null, usage: {}, finishReason: 'stop' });
  expect((await S.pick({ prompt: 'JSON' })).truncated).toBe(true);
  completeJson.mockResolvedValueOnce({ result: {}, usage: {}, finishReason: 'stop' });
  expect((await S.pick({ prompt: 'JSON' })).truncated).toBe(true);
});

test('the registry knows the job (env VIDEO_RECO_MODEL, default gpt-5-mini) and how its caller parses', () => {
  const R = require('../../../bot/shared/config/model-registry');
  delete process.env.VIDEO_RECO_MODEL;
  expect(R.modelFor('coaching.videoReco')).toBe('gpt-5-mini-2025-08-07');
});

test('a hung call is abandoned at the timeout (rejects; the engine turns it into an error row)', async () => {
  jest.useFakeTimers();
  completeJson.mockReturnValue(new Promise(() => {}));
  const p = S.pick({ prompt: 'JSON', timeoutMs: 20000 });
  jest.advanceTimersByTime(20001);
  await expect(p).rejects.toThrow(/timeout/);
  jest.useRealTimers();
});

test('deps.completeJson overrides the service (the evals harness seam)', async () => {
  const own = jest.fn().mockResolvedValue({ result: { seg_id: null }, usage: {} });
  await S.pick({ prompt: 'JSON', deps: { completeJson: own } });
  expect(own).toHaveBeenCalledTimes(1);
  expect(completeJson).not.toHaveBeenCalled();
});
