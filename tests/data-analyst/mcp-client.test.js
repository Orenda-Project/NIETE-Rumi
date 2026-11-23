'use strict';
/**
 * The JSON-RPC client to the data team's governed MCP. Mirrors their own slackbot/mcp_client.py: the
 * surface header on every call (here `whatsapp`), the asker's address when known, a Bearer token only
 * when one is configured, and the first text block of the result.
 */

const { McpClient, McpError, fromEnv } = require('../../bot/shared/services/data-analyst/mcp-client');

function fakeFetch(reply) {
  const calls = [];
  const impl = async (url, init) => {
    calls.push({ url, init, body: JSON.parse(init.body) });
    const r = typeof reply === 'function' ? reply(calls.length) : reply;
    if (r instanceof Error) throw r;
    return {
      ok: (r.status || 200) < 400,
      status: r.status || 200,
      headers: { get: (h) => (h.toLowerCase() === 'content-type' ? (r.contentType || 'application/json') : null) },
      text: async () => (typeof r.body === 'string' ? r.body : JSON.stringify(r.body)),
    };
  };
  impl.calls = calls;
  return impl;
}

const OK = (text) => ({ body: { jsonrpc: '2.0', id: 1, result: { content: [{ type: 'text', text }] } } });

test('posts tools/call with the surface and the asker on every request', async () => {
  const f = fakeFetch(OK('Taleemabad Data Navigator v0.42.5'));
  const c = new McpClient({ url: 'https://mcp.example/mcp', userEmail: 'operator@example.org', fetchImpl: f });
  await expect(c.callTool('get_version', {})).resolves.toBe('Taleemabad Data Navigator v0.42.5');
  const { url, init, body } = f.calls[0];
  expect(url).toBe('https://mcp.example/mcp');
  expect(init.method).toBe('POST');
  expect(init.headers['x-taleemabad-surface']).toBe('whatsapp');
  expect(init.headers['x-taleemabad-user']).toBe('operator@example.org');
  expect(init.headers.Accept).toBe('application/json, text/event-stream');
  expect(init.headers.Authorization).toBeUndefined();
  expect(body).toMatchObject({ jsonrpc: '2.0', method: 'tools/call', params: { name: 'get_version', arguments: {} } });
});

test('sends a Bearer token only when one is configured (their strict mode)', async () => {
  const f = fakeFetch(OK('x'));
  await new McpClient({ url: 'u', userEmail: 'a@b.c', token: 'tok-1', fetchImpl: f }).callTool('get_version', {});
  expect(f.calls[0].init.headers.Authorization).toBe('Bearer tok-1');
});

test('request ids increase', async () => {
  const f = fakeFetch(OK('x'));
  const c = new McpClient({ url: 'u', userEmail: 'a@b.c', fetchImpl: f });
  await c.callTool('a', {}); await c.callTool('b', {});
  expect(f.calls.map((x) => x.body.id)).toEqual([1, 2]);
});

test('reads a server-sent-events reply too', async () => {
  const sse = `event: message\ndata: ${JSON.stringify(OK('from sse').body)}\n\n`;
  const f = fakeFetch({ body: sse, contentType: 'text/event-stream' });
  await expect(new McpClient({ url: 'u', userEmail: 'a@b.c', fetchImpl: f }).callTool('x', {})).resolves.toBe('from sse');
});

test('an HTTP error, a JSON-RPC error, no text, bad JSON or a network failure is an McpError', async () => {
  const cases = [
    { status: 502, body: 'bad gateway' },
    { body: { jsonrpc: '2.0', id: 1, error: { message: 'boom' } } },
    { body: { jsonrpc: '2.0', id: 1, result: { content: [] } } },
    { body: 'not json' },
    new Error('ECONNRESET'),
  ];
  for (const r of cases) {
    const c = new McpClient({ url: 'u', userEmail: 'a@b.c', fetchImpl: fakeFetch(r) });
    await expect(c.callTool('x', {})).rejects.toBeInstanceOf(McpError);
  }
});

test('fromEnv: off without a url; surface defaults to whatsapp and may be overridden for a dev run', () => {
  expect(fromEnv({}, 'a@b.c')).toBeNull();
  const c = fromEnv({ DATA_MCP_URL: 'https://mcp.example/mcp' }, 'a@b.c');
  expect(c.headers()['x-taleemabad-surface']).toBe('whatsapp');
  const dev = fromEnv({ DATA_MCP_URL: 'https://mcp.example/mcp', DATA_MCP_SURFACE: 'whatsapp-dev' }, 'a@b.c');
  expect(dev.headers()['x-taleemabad-surface']).toBe('whatsapp-dev');
  expect(dev.surface).toBe('whatsapp-dev');
});
