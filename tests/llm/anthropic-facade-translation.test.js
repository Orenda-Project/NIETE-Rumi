/**
 * bd-gr4fy.2 — the direct-Anthropic facade carries what the jobs moving onto it actually send.
 *
 * Until now only two callers used the direct lane (lesson-plan authoring and the quiz key check),
 * and both were shaped to fit it. Moving the other jobs means the facade meets what they send:
 * JSON mode on 23 files, images on 15, `max_completion_tokens` on the gpt-5-mini cluster, and
 * OpenRouter's `reasoning: { effort }`. Each of those used to be a named throw or a 400.
 *
 * Two promises are held here, in this order:
 *   1. every request shape the direct lane already serves is byte-identical to before;
 *   2. the new shapes translate faithfully, and anything that still cannot be translated
 *      (tools, streaming, several choices, log-probs) still throws by name, so the caller's
 *      fallback runs instead of a quietly different answer.
 */
const {
  toNativeRequest,
  fromNativeResponse,
  LIST_PRICE_PER_MTOK,
} = require('../../bot/shared/services/anthropic-native-facade');

const textMsg = (text, extra = {}) => ({
  id: 'msg_1', model: 'claude-haiku-4-5', stop_reason: 'end_turn',
  content: [{ type: 'text', text }], usage: { input_tokens: 10, output_tokens: 5 }, ...extra,
});

describe('requests the lane already serves are unchanged', () => {
  test('the lesson-plan author shape: cached system blocks, max_tokens, temperature dropped, reasoning off', () => {
    const system = [{ type: 'text', text: 'You write lesson plans.', cache_control: { type: 'ephemeral' } }];
    const out = toNativeRequest({
      model: 'claude-sonnet-5',
      max_tokens: 24000,
      temperature: 0.2,
      reasoning: { enabled: false },
      messages: [{ role: 'system', content: system }, { role: 'user', content: 'Grade 3 maths' }],
    });
    expect(out).toEqual({
      model: 'claude-sonnet-5',
      max_tokens: 24000,
      system,
      messages: [{ role: 'user', content: 'Grade 3 maths' }],
      thinking: { type: 'disabled' },
    });
  });

  test('the quiz key-check shape: output_config passed through as given', () => {
    const out = toNativeRequest({
      model: 'claude-sonnet-5', max_tokens: 2000, output_config: { effort: 'low' },
      messages: [{ role: 'user', content: 'Solve this.' }],
    });
    expect(out).toEqual({
      model: 'claude-sonnet-5', max_tokens: 2000, output_config: { effort: 'low' },
      messages: [{ role: 'user', content: 'Solve this.' }],
    });
  });
});

describe('token limits', () => {
  test('max_completion_tokens becomes max_tokens', () => {
    const out = toNativeRequest({ model: 'claude-sonnet-5', max_completion_tokens: 1500, messages: [{ role: 'user', content: 'x' }] });
    expect(out.max_tokens).toBe(1500);
    expect(out.max_completion_tokens).toBeUndefined();
  });

  test('a request that names no limit gets one, because /v1/messages requires it', () => {
    const out = toNativeRequest({ model: 'claude-haiku-4-5', messages: [{ role: 'user', content: 'x' }] });
    expect(out.max_tokens).toBe(16000);
  });
});

describe('JSON mode', () => {
  test('json_object: no response_format reaches Anthropic, and the system prompt asks for one JSON object', () => {
    const out = toNativeRequest({
      model: 'claude-haiku-4-5', max_tokens: 800, response_format: { type: 'json_object' },
      messages: [{ role: 'system', content: 'Return JSON with a score.' }, { role: 'user', content: 'Lesson text' }],
    });
    expect(out.response_format).toBeUndefined();
    const sys = Array.isArray(out.system) ? out.system.map((b) => b.text).join('\n') : out.system;
    expect(sys).toContain('Return JSON with a score.');
    expect(sys).toMatch(/single valid JSON object/i);
  });

  test('json_object with no system message gets the instruction as the system prompt', () => {
    const out = toNativeRequest({
      model: 'claude-haiku-4-5', max_tokens: 800, response_format: { type: 'json_object' },
      messages: [{ role: 'user', content: 'Return JSON.' }],
    });
    expect(String(out.system)).toMatch(/single valid JSON object/i);
  });

  test('json_schema becomes structured output, merged with an effort already requested', () => {
    const schema = { type: 'object', properties: { score: { type: 'integer' } }, required: ['score'], additionalProperties: false };
    const out = toNativeRequest({
      model: 'claude-sonnet-5', max_tokens: 800, output_config: { effort: 'low' },
      response_format: { type: 'json_schema', json_schema: { name: 'score', strict: true, schema } },
      messages: [{ role: 'user', content: 'Score it.' }],
    });
    expect(out.output_config).toEqual({ effort: 'low', format: { type: 'json_schema', schema } });
    expect(out.response_format).toBeUndefined();
  });

  test('a fenced JSON answer comes back as bare JSON when JSON was asked for', () => {
    const res = fromNativeResponse(textMsg('```json\n{"score": 3}\n```'), { json: true });
    expect(JSON.parse(res.choices[0].message.content)).toEqual({ score: 3 });
  });

  test('prose around the object is trimmed when JSON was asked for', () => {
    const res = fromNativeResponse(textMsg('Here it is:\n{"a": [1, 2]}\nHope that helps.'), { json: true });
    expect(JSON.parse(res.choices[0].message.content)).toEqual({ a: [1, 2] });
  });

  test('without JSON mode the text is returned exactly as written', () => {
    const res = fromNativeResponse(textMsg('```json\n{"score": 3}\n```'));
    expect(res.choices[0].message.content).toBe('```json\n{"score": 3}\n```');
  });
});

describe('images', () => {
  test('a data URL becomes a base64 image block', () => {
    const out = toNativeRequest({
      model: 'claude-haiku-4-5', max_tokens: 500,
      messages: [{ role: 'user', content: [
        { type: 'text', text: 'Read this page.' },
        { type: 'image_url', image_url: { url: 'data:image/jpeg;base64,QUJD', detail: 'high' } },
      ] }],
    });
    expect(out.messages[0].content).toEqual([
      { type: 'text', text: 'Read this page.' },
      { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: 'QUJD' } },
    ]);
  });

  test('an https URL becomes a url image block', () => {
    const out = toNativeRequest({
      model: 'claude-haiku-4-5', max_tokens: 500,
      messages: [{ role: 'user', content: [{ type: 'image_url', image_url: { url: 'https://example.org/p.png' } }] }],
    });
    expect(out.messages[0].content).toEqual([{ type: 'image', source: { type: 'url', url: 'https://example.org/p.png' } }]);
  });

  test('an image type Anthropic does not accept throws by name', () => {
    expect(() => toNativeRequest({
      model: 'claude-haiku-4-5', max_tokens: 500,
      messages: [{ role: 'user', content: [{ type: 'image_url', image_url: { url: 'data:image/heic;base64,QUJD' } }] }],
    })).toThrow(/image\/heic/);
  });
});

describe('reasoning and sampling', () => {
  test("OpenRouter's reasoning effort becomes output_config.effort on a model that has one", () => {
    const out = toNativeRequest({ model: 'claude-sonnet-5', max_tokens: 4000, reasoning: { effort: 'minimal' }, messages: [{ role: 'user', content: 'x' }] });
    expect(out.output_config).toEqual({ effort: 'low' });
  });

  test("OpenAI's reasoning_effort maps the same way", () => {
    const out = toNativeRequest({ model: 'claude-opus-5', max_tokens: 4000, reasoning_effort: 'high', messages: [{ role: 'user', content: 'x' }] });
    expect(out.output_config).toEqual({ effort: 'high' });
  });

  test('Haiku has no effort setting, so the effort is dropped rather than sent', () => {
    const out = toNativeRequest({ model: 'claude-haiku-4-5', max_tokens: 400, reasoning_effort: 'low', messages: [{ role: 'user', content: 'x' }] });
    expect(out.output_config).toBeUndefined();
  });

  test('Haiku keeps the temperature the job was tuned at; Sonnet 5 rejects it, so it is dropped there', () => {
    const haiku = toNativeRequest({ model: 'claude-haiku-4-5', max_tokens: 10, temperature: 0, messages: [{ role: 'user', content: 'x' }] });
    const sonnet = toNativeRequest({ model: 'claude-sonnet-5', max_tokens: 10, temperature: 0, messages: [{ role: 'user', content: 'x' }] });
    expect(haiku.temperature).toBe(0);
    expect(sonnet.temperature).toBeUndefined();
  });

  test('OpenAI-only knobs with no meaning here are dropped, not forwarded and not fatal', () => {
    const out = toNativeRequest({
      model: 'claude-haiku-4-5', max_tokens: 100, n: 1, seed: 7, top_p: 0.9, presence_penalty: 0.1,
      frequency_penalty: 0.1, user: 'u1', verbosity: 'low', messages: [{ role: 'user', content: 'x' }],
    });
    for (const k of ['n', 'seed', 'top_p', 'presence_penalty', 'frequency_penalty', 'user', 'verbosity']) {
      expect(out[k]).toBeUndefined();
    }
  });

  test('stop becomes stop_sequences', () => {
    const out = toNativeRequest({ model: 'claude-haiku-4-5', max_tokens: 100, stop: '\n\n', messages: [{ role: 'user', content: 'x' }] });
    expect(out.stop_sequences).toEqual(['\n\n']);
  });

  test.each([
    ['tools', { tools: [{ type: 'function', function: { name: 'f' } }] }],
    ['stream', { stream: true }],
    ['n', { n: 2 }],
    ['logprobs', { logprobs: true }],
  ])('%s still cannot be translated faithfully and throws by name', (name, extra) => {
    expect(() => toNativeRequest({ model: 'claude-haiku-4-5', max_tokens: 100, messages: [{ role: 'user', content: 'x' }], ...extra }))
      .toThrow(new RegExp(name));
  });
});

describe('prices', () => {
  test('every Claude model a job may move to has a list price, so its spend is never recorded as free', () => {
    for (const m of ['claude-haiku-4-5', 'claude-sonnet-5', 'claude-opus-5', 'claude-fable-5-1']) {
      expect(LIST_PRICE_PER_MTOK[m]).toBeDefined();
    }
  });
});
