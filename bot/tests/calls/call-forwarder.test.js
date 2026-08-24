/**
 * P0.2 (bd-1hae7.2) — the bot→calls-service forward.
 *
 * The message bot owns the public webhook; the calls service owns the media. So
 * the bot recognises a `value.calls` payload, hands it straight over Railway
 * private networking, and returns — a calls payload must NEVER fall into
 * message handling (that is what produced "I can only respond in voice or text"
 * for reactions, bd-fbih0).
 *
 * The forward is authenticated with a shared secret and fails CLOSED: no secret,
 * no forward. Without that, anything that can reach the public webhook could
 * make us dial Graph and burn call slots.
 */

describe('call-forwarder — extraction', () => {
  const { extractCallEvents } = require('../../shared/calls/call-forwarder');

  const callsPayload = {
    entry: [{
      changes: [{
        field: 'calls',
        value: {
          messaging_product: 'whatsapp',
          metadata: { phone_number_id: '1155653510968291' },
          contacts: [{ wa_id: '923001234567', profile: { name: 'Ayesha' } }],
          calls: [{ id: 'CALL1', from: '923001234567', event: 'connect', session: { sdp_type: 'offer', sdp: 'v=0' } }],
        },
      }],
    }],
  };

  test('pulls the call events, contacts and metadata out of a calls payload', () => {
    const extracted = extractCallEvents(callsPayload);
    expect(extracted.calls).toHaveLength(1);
    expect(extracted.calls[0].id).toBe('CALL1');
    expect(extracted.contacts[0].profile.name).toBe('Ayesha');
    expect(extracted.metadata.phone_number_id).toBe('1155653510968291');
  });

  test('returns null for an ordinary message payload — the bot handles those', () => {
    expect(extractCallEvents({
      entry: [{ changes: [{ field: 'messages', value: { messages: [{ id: 'wamid.1', type: 'text' }] } }] }],
    })).toBeNull();
  });

  test('returns null for a status payload', () => {
    expect(extractCallEvents({
      entry: [{ changes: [{ field: 'messages', value: { statuses: [{ id: 'wamid.1', status: 'read' }] } }] }],
    })).toBeNull();
  });

  test('an empty calls array is treated as nothing to do', () => {
    expect(extractCallEvents({ entry: [{ changes: [{ field: 'calls', value: { calls: [] } }] }] })).toBeNull();
  });

  test('malformed and empty bodies never throw', () => {
    expect(extractCallEvents(undefined)).toBeNull();
    expect(extractCallEvents({})).toBeNull();
    expect(extractCallEvents({ entry: [] })).toBeNull();
    expect(extractCallEvents({ entry: [{ changes: [{}] }] })).toBeNull();
  });

  test('a payload carrying BOTH messages and calls still yields the calls', () => {
    // Defensive: the bot must handle its messages AND hand the calls over.
    const extracted = extractCallEvents({
      entry: [{
        changes: [{
          value: {
            messages: [{ id: 'wamid.1', type: 'text' }],
            calls: [{ id: 'CALL9', event: 'terminate' }],
          },
        }],
      }],
    });
    expect(extracted.calls[0].id).toBe('CALL9');
  });
});

describe('call-forwarder — delivery', () => {
  let forwarder;
  let fetchMock;

  beforeEach(() => {
    jest.resetModules();
    process.env.CALLS_SERVICE_URL = 'http://calls.railway.internal:8080';
    process.env.CALLS_FORWARD_SECRET = 'shared-secret';
    fetchMock = jest.fn(async () => ({ ok: true, status: 200 }));
    global.fetch = fetchMock;
    forwarder = require('../../shared/calls/call-forwarder');
  });

  afterEach(() => {
    delete process.env.CALLS_SERVICE_URL;
    delete process.env.CALLS_FORWARD_SECRET;
  });

  const payload = { calls: [{ id: 'CALL1', event: 'connect' }], contacts: [], metadata: {} };

  test('POSTs the events to the calls service with the shared secret', async () => {
    await forwarder.forwardCallEvents(payload);

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('http://calls.railway.internal:8080/internal/call-event');
    expect(init.method).toBe('POST');
    expect(init.headers['x-calls-secret']).toBe('shared-secret');
    expect(JSON.parse(init.body).calls[0].id).toBe('CALL1');
  });

  test('does NOT forward when no secret is configured (fails closed)', async () => {
    delete process.env.CALLS_FORWARD_SECRET;
    jest.resetModules();
    const unconfigured = require('../../shared/calls/call-forwarder');
    await unconfigured.forwardCallEvents(payload);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  test('does NOT forward when no service URL is configured', async () => {
    delete process.env.CALLS_SERVICE_URL;
    jest.resetModules();
    const unconfigured = require('../../shared/calls/call-forwarder');
    await unconfigured.forwardCallEvents(payload);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  test('a calls service that is down never breaks the bot webhook', async () => {
    fetchMock.mockRejectedValue(new Error('ECONNREFUSED'));
    await expect(forwarder.forwardCallEvents(payload)).resolves.toBeUndefined();
  });

  test('a non-2xx from the calls service never throws into the webhook', async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 500 });
    await expect(forwarder.forwardCallEvents(payload)).resolves.toBeUndefined();
  });

  test('a trailing slash on the service URL does not double up the path', async () => {
    process.env.CALLS_SERVICE_URL = 'http://calls.railway.internal:8080/';
    jest.resetModules();
    const trailing = require('../../shared/calls/call-forwarder');
    await trailing.forwardCallEvents(payload);
    expect(fetchMock.mock.calls[0][0]).toBe('http://calls.railway.internal:8080/internal/call-event');
  });
});

describe('call-forwarder — secret verification (calls-service side)', () => {
  const { verifyForwardSecret } = require('../../shared/calls/call-forwarder');

  test('accepts the matching secret', () => {
    expect(verifyForwardSecret('abc123', 'abc123')).toBe(true);
  });

  test('rejects a wrong secret', () => {
    expect(verifyForwardSecret('abc123', 'wrong')).toBe(false);
  });

  test('rejects when either side is missing — never a blank-passes-blank hole', () => {
    expect(verifyForwardSecret('', '')).toBe(false);
    expect(verifyForwardSecret('abc123', undefined)).toBe(false);
    expect(verifyForwardSecret(undefined, 'abc123')).toBe(false);
  });

  test('rejects a same-length mismatch and a length mismatch alike', () => {
    expect(verifyForwardSecret('abc123', 'abc124')).toBe(false);
    expect(verifyForwardSecret('abc123', 'abc1234567')).toBe(false);
  });
});
