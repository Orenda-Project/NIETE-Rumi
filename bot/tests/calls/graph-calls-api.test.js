/**
 * P0.1 (bd-1hae7.1) — the WhatsApp Calling API client.
 *
 * POST /{PHONE_NUMBER_ID}/calls with an action of pre_accept | accept | reject |
 * terminate. Same fetch/Bearer idiom as WhatsAppService so there is one way this
 * repo talks to Graph. The contract these tests pin: the SDP goes up as an
 * ANSWER (sending it as an offer silently produces a dead call), every request
 * carries messaging_product, and a Graph failure surfaces as a thrown error the
 * engine can turn into terminate-and-free-the-line.
 */

describe('graph-calls-api', () => {
  let api;
  let fetchMock;

  beforeEach(() => {
    jest.resetModules();
    process.env.WHATSAPP_TOKEN = 'TEST_TOKEN';
    process.env.PHONE_NUMBER_ID = '1155653510968291';
    fetchMock = jest.fn(async () => ({ ok: true, status: 200, json: async () => ({ success: true }) }));
    global.fetch = fetchMock;
    api = require('../../shared/calls/graph-calls-api');
  });

  const body = () => JSON.parse(fetchMock.mock.calls[0][1].body);

  test('accept posts the SDP as an ANSWER on the calls edge', async () => {
    await api.accept('CALL1', 'ANSWER_SDP');

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toContain('/1155653510968291/calls');
    expect(init.method).toBe('POST');
    expect(init.headers.Authorization).toBe('Bearer TEST_TOKEN');
    expect(body()).toEqual({
      messaging_product: 'whatsapp',
      call_id: 'CALL1',
      action: 'accept',
      session: { sdp_type: 'answer', sdp: 'ANSWER_SDP' },
    });
  });

  test('pre_accept sends the same answer payload under the pre_accept action', async () => {
    await api.preAccept('CALL1', 'ANSWER_SDP');
    expect(body()).toEqual(expect.objectContaining({
      action: 'pre_accept',
      session: { sdp_type: 'answer', sdp: 'ANSWER_SDP' },
    }));
  });

  test('reject carries no session payload', async () => {
    await api.reject('CALL1');
    expect(body()).toEqual({ messaging_product: 'whatsapp', call_id: 'CALL1', action: 'reject' });
  });

  test('terminate carries no session payload', async () => {
    await api.terminate('CALL1');
    expect(body()).toEqual({ messaging_product: 'whatsapp', call_id: 'CALL1', action: 'terminate' });
  });

  test('a Graph error throws so the engine can free the line', async () => {
    fetchMock.mockResolvedValue({
      ok: false, status: 400, json: async () => ({ error: { message: 'Invalid call id' } }),
    });
    await expect(api.accept('BAD', 'SDP')).rejects.toThrow(/Invalid call id/);
  });

  test('a non-JSON error body still throws with the status', async () => {
    fetchMock.mockResolvedValue({
      ok: false, status: 502, json: async () => { throw new Error('not json'); },
    });
    await expect(api.terminate('CALL1')).rejects.toThrow(/502/);
  });

  test('the graph version is env-tunable and defaults to the repo standard', async () => {
    delete process.env.GRAPH_API_VERSION;
    await api.reject('CALL1');
    expect(fetchMock.mock.calls[0][0]).toContain('/v21.0/');

    // Read per request, not at import: bumping the version for the Calling API
    // must not need a redeploy of the module graph.
    process.env.GRAPH_API_VERSION = 'v23.0';
    await api.reject('CALL2');
    expect(fetchMock.mock.calls[1][0]).toContain('/v23.0/');
    delete process.env.GRAPH_API_VERSION;
  });
});
