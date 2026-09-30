/**
 * P0.1 (bd-1hae7.1) — the OpenAI GA Realtime client.
 *
 * Pinned contracts (each one a real outage if it regresses):
 *  - GA shape: /v1/realtime with NO `OpenAI-Beta` header. Sending `realtime=v1`
 *    forces the retired beta shape and every session errors `beta_api_shape_disabled`.
 *  - Both event-name generations are handled (`response.output_audio.delta` and
 *    the older `response.audio.delta`) — a rename must not silence the assistant.
 *  - A tool handler that throws returns a safe string to the model instead of
 *    tearing down a live call.
 */

const RealtimeClient = require('../../shared/calls/realtime-client');
const pcm = require('../../shared/calls/pcm');

class FakeWs {
  constructor(url, opts) {
    FakeWs.last = this;
    this.url = url;
    this.opts = opts;
    this.readyState = 1;
    this.sent = [];
    this.handlers = {};
    this.closed = false;
  }

  on(evt, cb) { this.handlers[evt] = cb; return this; }

  send(data) { this.sent.push(JSON.parse(data)); }

  close() { this.closed = true; this.readyState = 3; }

  // --- test drivers ---
  open() { this.handlers.open?.(); }

  emit(obj) { this.handlers.message?.(JSON.stringify(obj)); }

  sentOfType(type) { return this.sent.filter((m) => m.type === type); }
}

FakeWs.OPEN = 1;

function makeClient(overrides = {}) {
  const cb = {
    onAudio: jest.fn(),
    onTranscript: jest.fn(),
    onBargeIn: jest.fn(),
    onResponseLatency: jest.fn(),
    onOpen: jest.fn(),
    onClose: jest.fn(),
    onError: jest.fn(),
    ...overrides,
  };
  const client = new RealtimeClient({
    instructions: 'BASE INSTRUCTIONS',
    apiKey: 'sk-test',
    model: 'gpt-realtime-2.1-mini',
    voice: 'marin',
    tools: overrides.tools,
    callbacks: cb,
    wsFactory: (url, opts) => new FakeWs(url, opts),
  });
  return { client, cb };
}

describe('RealtimeClient — connection shape', () => {
  test('connects to the GA endpoint with the model in the query', () => {
    const { client } = makeClient();
    client.connect();
    expect(FakeWs.last.url).toBe(
      'wss://api.openai.com/v1/realtime?model=gpt-realtime-2.1-mini',
    );
  });

  test('sends the API key and NO OpenAI-Beta header (the beta shape is retired)', () => {
    const { client } = makeClient();
    client.connect();
    expect(FakeWs.last.opts.headers.Authorization).toBe('Bearer sk-test');
    const headerNames = Object.keys(FakeWs.last.opts.headers).map((h) => h.toLowerCase());
    expect(headerNames).not.toContain('openai-beta');
  });
});

describe('RealtimeClient — session configuration', () => {
  test('configures a realtime audio session with semantic VAD and caller transcription', () => {
    const { client } = makeClient();
    client.connect();
    FakeWs.last.open();

    const [update] = FakeWs.last.sentOfType('session.update');
    expect(update.session.type).toBe('realtime');
    expect(update.session.instructions).toBe('BASE INSTRUCTIONS');
    expect(update.session.output_modalities).toEqual(['audio']);
    expect(update.session.audio.input.turn_detection).toEqual(
      expect.objectContaining({ type: 'semantic_vad', create_response: true, interrupt_response: true }),
    );
    expect(update.session.audio.input.transcription.model).toBeTruthy();
    expect(update.session.audio.output.voice).toBe('marin');
    expect(update.session.audio.output.format.rate).toBe(24000);
  });

  test('greets first so the caller hears her immediately after connect', () => {
    const { client } = makeClient();
    client.connect();
    FakeWs.last.open();
    expect(FakeWs.last.sentOfType('response.create').length).toBe(1);
    // …and the greeting is requested AFTER the session is configured.
    expect(FakeWs.last.sent.findIndex((m) => m.type === 'session.update'))
      .toBeLessThan(FakeWs.last.sent.findIndex((m) => m.type === 'response.create'));
  });

  test('server_vad is selectable for noisy lines', () => {
    const { client } = makeClient();
    client.vad = 'server_vad';
    client.connect();
    FakeWs.last.open();
    const [update] = FakeWs.last.sentOfType('session.update');
    expect(update.session.audio.input.turn_detection.type).toBe('server_vad');
  });

  test('tools are registered when supplied, with auto tool choice', () => {
    const tools = [{ type: 'function', name: 'recall_niete', description: 'd', parameters: { type: 'object', properties: {} } }];
    const { client } = makeClient({ tools });
    client.connect();
    FakeWs.last.open();
    const [update] = FakeWs.last.sentOfType('session.update');
    expect(update.session.tools).toEqual(tools);
    expect(update.session.tool_choice).toBe('auto');
  });

  test('no tools key at all when none are supplied', () => {
    const { client } = makeClient();
    client.connect();
    FakeWs.last.open();
    expect(FakeWs.last.sentOfType('session.update')[0].session.tools).toBeUndefined();
  });
});

describe('RealtimeClient — appendInstructions (late context, used once)', () => {
  test('before the session is ready it folds into the INITIAL update', () => {
    const { client } = makeClient();
    client.connect();
    client.appendInstructions('LATE BLOCK');
    FakeWs.last.open();
    expect(FakeWs.last.sentOfType('session.update')[0].session.instructions)
      .toBe('BASE INSTRUCTIONS\n\nLATE BLOCK');
  });

  test('after the session is ready it pushes a session.update', () => {
    const { client } = makeClient();
    client.connect();
    FakeWs.last.open();
    client.appendInstructions('LATE BLOCK');
    const updates = FakeWs.last.sentOfType('session.update');
    expect(updates.length).toBe(2);
    expect(updates[1].session.instructions).toContain('LATE BLOCK');
  });

  test('empty/whitespace appends are ignored', () => {
    const { client } = makeClient();
    client.connect();
    FakeWs.last.open();
    client.appendInstructions('   ');
    expect(FakeWs.last.sentOfType('session.update').length).toBe(1);
  });

  test('the composed instructions are readable for the context snapshot (P3.1)', () => {
    const { client } = makeClient();
    client.connect();
    FakeWs.last.open();
    client.appendInstructions('LATE BLOCK');
    expect(client.getInstructions()).toBe('BASE INSTRUCTIONS\n\nLATE BLOCK');
  });
});

describe('RealtimeClient — media and transcripts', () => {
  test('audio deltas are decoded to PCM16 for the caller', () => {
    const { client, cb } = makeClient();
    client.connect();
    FakeWs.last.open();
    const samples = Int16Array.from([1, -1, 500]);
    FakeWs.last.emit({ type: 'response.output_audio.delta', delta: pcm.int16ToBase64(samples) });
    expect(Array.from(cb.onAudio.mock.calls[0][0])).toEqual([1, -1, 500]);
  });

  test('the older response.audio.delta event name is handled too', () => {
    const { client, cb } = makeClient();
    client.connect();
    FakeWs.last.open();
    FakeWs.last.emit({ type: 'response.audio.delta', delta: pcm.int16ToBase64(Int16Array.from([7])) });
    expect(cb.onAudio).toHaveBeenCalled();
  });

  test('caller speech is transcribed under the caller role', () => {
    const { client, cb } = makeClient();
    client.connect();
    FakeWs.last.open();
    FakeWs.last.emit({
      type: 'conversation.item.input_audio_transcription.completed',
      transcript: 'میرا سبق کیسا تھا',
    });
    expect(cb.onTranscript).toHaveBeenCalledWith('caller', 'میرا سبق کیسا تھا');
  });

  test('assistant speech is transcribed under the assistant role, both event names', () => {
    const { client, cb } = makeClient();
    client.connect();
    FakeWs.last.open();
    FakeWs.last.emit({ type: 'response.output_audio_transcript.done', transcript: 'جی بالکل' });
    FakeWs.last.emit({ type: 'response.audio_transcript.done', transcript: 'دوسرا' });
    expect(cb.onTranscript).toHaveBeenNthCalledWith(1, 'assistant', 'جی بالکل');
    expect(cb.onTranscript).toHaveBeenNthCalledWith(2, 'assistant', 'دوسرا');
  });

  test('caller speech start signals barge-in so playout can flush', () => {
    const { client, cb } = makeClient();
    client.connect();
    FakeWs.last.open();
    FakeWs.last.emit({ type: 'input_audio_buffer.speech_started' });
    expect(cb.onBargeIn).toHaveBeenCalled();
  });

  test('response latency is measured turn-end → first audio, once per turn', () => {
    const { client, cb } = makeClient();
    client.connect();
    FakeWs.last.open();
    FakeWs.last.emit({ type: 'input_audio_buffer.speech_stopped' });
    const b64 = pcm.int16ToBase64(Int16Array.from([1]));
    FakeWs.last.emit({ type: 'response.output_audio.delta', delta: b64 });
    FakeWs.last.emit({ type: 'response.output_audio.delta', delta: b64 });
    expect(cb.onResponseLatency).toHaveBeenCalledTimes(1);
    expect(typeof cb.onResponseLatency.mock.calls[0][0]).toBe('number');
  });

  test('caller audio is appended as base64 only once the session is ready', () => {
    const { client } = makeClient();
    client.connect();
    client.appendAudio(Int16Array.from([1, 2])); // pre-ready — dropped, not queued
    expect(FakeWs.last.sentOfType('input_audio_buffer.append').length).toBe(0);
    FakeWs.last.open();
    client.appendAudio(Int16Array.from([1, 2]));
    expect(FakeWs.last.sentOfType('input_audio_buffer.append').length).toBe(1);
  });

  test('malformed frames never crash the session', () => {
    const { client, cb } = makeClient();
    client.connect();
    FakeWs.last.open();
    expect(() => FakeWs.last.handlers.message('not json at all')).not.toThrow();
    expect(cb.onAudio).not.toHaveBeenCalled();
  });
});

describe('RealtimeClient — tool calls', () => {
  const toolCall = (ws, { callId = 'fc1', name = 'recall_niete', args = '{"query":"x"}' } = {}) => {
    ws.emit({ type: 'response.output_item.added', item: { type: 'function_call', call_id: callId, name } });
    return ws.handlers.message(JSON.stringify({
      type: 'response.function_call_arguments.done', call_id: callId, arguments: args,
    }));
  };

  test('a tool result is fed back as function_call_output and the model continues', async () => {
    const onToolCall = jest.fn(async () => 'TOOL RESULT');
    const { client } = makeClient({ onToolCall });
    client.connect();
    FakeWs.last.open();
    await toolCall(FakeWs.last);
    await new Promise((r) => setImmediate(r));

    expect(onToolCall).toHaveBeenCalledWith('recall_niete', { query: 'x' });
    const [output] = FakeWs.last.sentOfType('conversation.item.create');
    expect(output.item).toEqual({ type: 'function_call_output', call_id: 'fc1', output: 'TOOL RESULT' });
    expect(FakeWs.last.sentOfType('response.create').length).toBe(2); // greeting + continue
  });

  test('a throwing tool returns a safe string instead of killing the call', async () => {
    const onToolCall = jest.fn(async () => { throw new Error('db down'); });
    const { client, cb } = makeClient({ onToolCall });
    client.connect();
    FakeWs.last.open();
    await toolCall(FakeWs.last);
    await new Promise((r) => setImmediate(r));

    const [output] = FakeWs.last.sentOfType('conversation.item.create');
    expect(typeof output.item.output).toBe('string');
    expect(output.item.output.length).toBeGreaterThan(0);
    expect(cb.onClose).not.toHaveBeenCalled();
  });

  test('unparseable tool arguments still invoke the tool with an empty object', async () => {
    const onToolCall = jest.fn(async () => 'ok');
    const { client } = makeClient({ onToolCall });
    client.connect();
    FakeWs.last.open();
    await toolCall(FakeWs.last, { args: '{not json' });
    await new Promise((r) => setImmediate(r));
    expect(onToolCall).toHaveBeenCalledWith('recall_niete', {});
  });

  test('the tool name is remembered from output_item.added when the done event omits it', async () => {
    const onToolCall = jest.fn(async () => 'ok');
    const { client } = makeClient({ onToolCall });
    client.connect();
    FakeWs.last.open();
    FakeWs.last.emit({ type: 'response.output_item.added', item: { type: 'function_call', call_id: 'fc9', name: 'search_history' } });
    FakeWs.last.emit({ type: 'response.function_call_arguments.done', call_id: 'fc9', arguments: '{}' });
    await new Promise((r) => setImmediate(r));
    expect(onToolCall).toHaveBeenCalledWith('search_history', {});
  });
});

describe('RealtimeClient — teardown', () => {
  test('close closes the socket and stops sending', () => {
    const { client } = makeClient();
    client.connect();
    FakeWs.last.open();
    const ws = FakeWs.last;
    client.close();
    expect(ws.closed).toBe(true);
    client.appendAudio(Int16Array.from([1]));
    expect(ws.sentOfType('input_audio_buffer.append').length).toBe(0);
  });

  test('a socket close notifies the owner so the session can tear down', () => {
    const { client, cb } = makeClient();
    client.connect();
    FakeWs.last.open();
    FakeWs.last.handlers.close?.();
    expect(cb.onClose).toHaveBeenCalled();
  });

  test('an error event is reported, not thrown', () => {
    const { client, cb } = makeClient();
    client.connect();
    FakeWs.last.handlers.error?.(new Error('socket blew up'));
    expect(cb.onError).toHaveBeenCalled();
  });
});
