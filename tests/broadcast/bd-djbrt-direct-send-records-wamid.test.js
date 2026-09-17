/**
 * bd-djbrt — the direct (non-template) broadcast path must record the wamid,
 * and must never report a recording failure as a send failure or as a success.
 *
 * Why this exists: on 2026-09-17 a 501-teacher launch broadcast recorded no
 * message_id at all, so handleBroadcastStatusWebhook could not match a single
 * delivery or read receipt and discarded every one of them (bd-zo16z). Two
 * defects combined — the call site dropped sendDirectMessage's response, and
 * createBroadcastMessage had no message_id parameter and swallowed its insert
 * error, so the loss was invisible.
 *
 * Mocks stop at the network boundaries only: the WhatsApp HTTP call (axios) and
 * the Supabase client. The service -> queries -> insert chain runs for real, so
 * these assertions execute the changed lines rather than a stand-in.
 */

const WAMID = 'wamid.HBgMOTIzMzM1MDI3Nzc0FQIAERgSRkFLRTAwMDAwMDAwMDAwMDAwAA==';

const mockInserts = [];
let mockInsertError = null;
let mockAxiosPost = null;

jest.mock('axios', () => ({
  post: (...args) => mockAxiosPost(...args),
  get: jest.fn(),
}));

jest.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    from: (table) => ({
      insert: (rows) => {
        mockInserts.push({ table, rows });
        return Promise.resolve({ data: null, error: mockInsertError });
      },
      update: () => ({ eq: () => ({ eq: () => Promise.resolve({ data: null, error: null }) }) }),
      select: () => ({ eq: () => ({ single: () => Promise.resolve({ data: null, error: null }) }) }),
    }),
    rpc: () => Promise.resolve({ data: null, error: null }),
  }),
}));

let queries;
let broadcastService;

beforeAll(() => {
  process.env.SUPABASE_URL = 'https://test.supabase.co';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-key';
  process.env.PHONE_NUMBER_ID = '000';
  process.env.WHATSAPP_TOKEN = 'test-token';
  queries = require('../../dashboard/database/queries');
  broadcastService = require('../../dashboard/services/whatsapp-broadcast.service');
});

beforeEach(() => {
  mockInserts.length = 0;
  mockInsertError = null;
  mockAxiosPost = jest.fn(async () => ({ data: { messages: [{ id: WAMID }] } }));
  jest.spyOn(console, 'error').mockImplementation(() => {});
  jest.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => jest.restoreAllMocks());

const USER = { id: 'user-uuid-1', phone_number: '923000000001' };
const BROADCAST = 'broadcast-uuid-1';

describe('queries.createBroadcastMessage', () => {
  it('writes the wamid to message_id so status webhooks can match it', async () => {
    await queries.createBroadcastMessage(BROADCAST, USER.id, USER.phone_number, 'sent', null, WAMID);

    expect(mockInserts).toHaveLength(1);
    expect(mockInserts[0].table).toBe('broadcast_messages');
    expect(mockInserts[0].rows).toMatchObject({
      broadcast_id: BROADCAST,
      user_id: USER.id,
      phone_number: USER.phone_number,
      status: 'sent',
      message_id: WAMID,
    });
  });

  it('throws when the insert fails, instead of swallowing it', async () => {
    mockInsertError = { message: 'duplicate key value violates unique constraint' };

    await expect(
      queries.createBroadcastMessage(BROADCAST, USER.id, USER.phone_number, 'sent', null, WAMID)
    ).rejects.toThrow('duplicate key value violates unique constraint');
  });
});

describe('broadcastService.sendDirectAndRecord', () => {
  it('records the wamid returned by the send', async () => {
    const result = await broadcastService.sendDirectAndRecord(BROADCAST, USER, 'hello');

    expect(result).toMatchObject({ outcome: 'sent', messageId: WAMID });
    expect(mockInserts).toHaveLength(1);
    expect(mockInserts[0].rows.message_id).toBe(WAMID);
  });

  it('reports sent_unrecorded when the send worked but the row did not save', async () => {
    mockInsertError = { message: 'connection reset' };

    const result = await broadcastService.sendDirectAndRecord(BROADCAST, USER, 'hello');

    // The teacher HAS the message. Calling this a failed send would be a lie,
    // and calling it a plain success is what hid the 17 Sep receipt loss.
    expect(result.outcome).toBe('sent_unrecorded');
    expect(result.messageId).toBe(WAMID);
    expect(console.error).toHaveBeenCalledWith(
      expect.stringContaining('SENT BUT NOT RECORDED'),
      'connection reset'
    );
  });

  it('records a failed send as failed and returns no wamid', async () => {
    mockAxiosPost = jest.fn(async () => { throw new Error('131049 frequency cap'); });

    const result = await broadcastService.sendDirectAndRecord(BROADCAST, USER, 'hello');

    expect(result).toMatchObject({ outcome: 'failed', messageId: null });
    expect(result.error).toContain('131049');
    expect(mockInserts).toHaveLength(1);
    expect(mockInserts[0].rows).toMatchObject({ status: 'failed', message_id: null });
  });

  it('warns when Meta accepts the send but returns no wamid', async () => {
    mockAxiosPost = jest.fn(async () => ({ data: { messages: [] } }));

    const result = await broadcastService.sendDirectAndRecord(BROADCAST, USER, 'hello');

    // A row with a null message_id can never be matched to a receipt, so this
    // must not pass silently.
    expect(result.outcome).toBe('sent');
    expect(result.messageId).toBeNull();
    expect(console.warn).toHaveBeenCalledWith(expect.stringContaining('no message id'));
  });
});
