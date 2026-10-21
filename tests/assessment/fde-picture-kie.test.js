/**
 * The Grade 1-2 pictures drawn by the image model (bd-5jmnfj.4.3): the prompt for
 * an object, a scene or a count, and one Kie nano-banana-pro task — create, poll,
 * download. Fetch and sleep are injected; nothing leaves the test.
 */

const Kie = require('../../bot/shared/services/assessment/fde-picture-kie');

const json = (body) => ({ ok: true, json: async () => body });

function fakeFetch(states, { create = { code: 200, data: { taskId: 't1' } } } = {}) {
  const calls = [];
  const queue = [...states];
  const fetchImpl = async (url, opts = {}) => {
    calls.push({ url, opts });
    if (url.endsWith('/createTask')) return json(create);
    if (url.includes('/recordInfo')) return json({ data: queue.shift() });
    return { ok: true, arrayBuffer: async () => Uint8Array.from([1, 2, 3]).buffer };
  };
  return { fetchImpl, calls };
}

const opts = (f) => ({ apiKey: 'k', fetchImpl: f.fetchImpl, sleep: async () => {}, maxPolls: 5 });

test('object and count prompts name the object as a plain line drawing with no writing', () => {
  const p = Kie.promptFor({ kind: 'object', name: 'apple' });
  expect(p).toContain('apple');
  expect(p).toMatch(/black and white line drawing/i);
  expect(Kie.promptFor({ kind: 'count', name: 'apple', n: 4 })).toBe(p);
});

test('a scene prompt carries the description', () => {
  expect(Kie.promptFor({ kind: 'scene', describe: 'a long pencil and a short pencil' })).toContain('a long pencil and a short pencil');
});

test('a picture with nothing to draw is refused', () => {
  expect(() => Kie.promptFor({ kind: 'object', name: '' })).toThrow('nothing to draw');
  expect(() => Kie.promptFor({ kind: 'scene' })).toThrow('nothing to draw');
  expect(() => Kie.promptFor({ kind: 'dots', n: 3 })).toThrow('not an image-model picture');
});

test('one task: created with the key, polled until success, the result downloaded', async () => {
  const f = fakeFetch([{ state: 'waiting' }, { state: 'success', resultJson: JSON.stringify({ resultUrls: ['https://cdn/x.png'] }) }]);
  const buf = await Kie.generateImage('draw', opts(f));
  expect(Buffer.isBuffer(buf)).toBe(true);
  expect(buf.length).toBe(3);
  const create = f.calls[0];
  expect(create.url).toBe('https://api.kie.ai/api/v1/jobs/createTask');
  expect(create.opts.headers.Authorization).toBe('Bearer k');
  const body = JSON.parse(create.opts.body);
  expect(body.model).toBe('nano-banana-pro');
  expect(body.input.prompt).toBe('draw');
  expect(body.input.negative_prompt).toMatch(/text/);
  expect(f.calls[1].url).toBe('https://api.kie.ai/api/v1/jobs/recordInfo?taskId=t1');
  expect(f.calls[f.calls.length - 1].url).toBe('https://cdn/x.png');
});

test('a failed task, a task never created or a task that never finishes throws', async () => {
  await expect(Kie.generateImage('d', opts(fakeFetch([{ state: 'fail', failMsg: 'nope' }])))).rejects.toThrow('nope');
  await expect(Kie.generateImage('d', opts(fakeFetch([], { create: { code: 401, msg: 'bad key' } })))).rejects.toThrow('no task');
  await expect(Kie.generateImage('d', opts(fakeFetch([{ state: 'waiting' }, { state: 'waiting' }, { state: 'waiting' }, { state: 'waiting' }, { state: 'waiting' }])))).rejects.toThrow('did not finish');
});

test('no key is refused before any call', async () => {
  const f = fakeFetch([]);
  await expect(Kie.generateImage('d', { ...opts(f), apiKey: '' })).rejects.toThrow('KIE_API_KEY');
  expect(f.calls).toHaveLength(0);
});
