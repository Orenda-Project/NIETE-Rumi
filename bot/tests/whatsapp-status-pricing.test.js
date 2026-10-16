/**
 * WhatsApp cost by teacher (bd-v0toag.65). Meta puts the price of every delivered message on its status
 * webhook (`pricing.billable`, `pricing.category`, `pricing.type`); the bot dropped it. These tests pin the
 * event the v10 tracker sums: `whatsapp.status.priced`, one per delivered/read status, keyed by users.id,
 * never the phone. Design: ICT NIETE/ab-test-v10-coaching/versions/v19_whatsapp_cost_design/DESIGN.md.
 */
const fs = require('fs');
const path = require('path');

jest.mock('../shared/config/supabase', () => ({ from: jest.fn() }));
jest.mock('../shared/utils/structured-logger', () => {
  const actual = jest.requireActual('../shared/utils/structured-logger');
  return { ...actual, logEvent: jest.fn() };
});
jest.mock('../shared/utils/validators', () => ({ isOurPhoneNumber: jest.fn(() => true) }));

const supabase = require('../shared/config/supabase');
const { logEvent, normalizeForAxiom } = require('../shared/utils/structured-logger');
const validators = require('../shared/utils/validators');
const { pricedFields, logPricedStatuses, handleStatusWebhook } = require('../shared/services/whatsapp-status-pricing');

function aStatus(over = {}) {
  return {
    id: 'wamid.A1',
    status: 'delivered',
    timestamp: '1760600000',
    recipient_id: '923001112223',
    pricing: { billable: true, pricing_model: 'PMP', category: 'utility', type: 'regular' },
    ...over,
  };
}

/** users.select('id, phone_number').in('phone_number', phones).is('deleted_at', null) */
function usersReturn(result) {
  const chain = {};
  chain.select = jest.fn(() => chain);
  chain.in = jest.fn(() => chain);
  chain.is = jest.fn(() => Promise.resolve(result));
  supabase.from.mockReturnValue(chain);
  return chain;
}

beforeEach(() => {
  jest.clearAllMocks();
  validators.isOurPhoneNumber.mockReturnValue(true);
});

describe('pricedFields', () => {
  test('reads billable, category, pricing_model and type from a delivered status', () => {
    expect(pricedFields(aStatus())).toEqual({
      wamid: 'wamid.A1', status: 'delivered', billable: true, category: 'utility',
      pricingModel: 'PMP', pricingType: 'regular', phone: '923001112223',
    });
  });

  test('read statuses are priced too', () => {
    expect(pricedFields(aStatus({ status: 'read' })).status).toBe('read');
  });

  test('billable false stays false, not missing', () => {
    expect(pricedFields(aStatus({ pricing: { billable: false, category: 'service', type: 'free_customer_service' } })).billable).toBe(false);
  });

  test.each(['sent', 'failed'])('returns null for %s', (s) => {
    expect(pricedFields(aStatus({ status: s }))).toBeNull();
  });

  test('returns null when Meta sent no pricing (nothing logged, never $0)', () => {
    expect(pricedFields(aStatus({ pricing: undefined }))).toBeNull();
    expect(pricedFields(null)).toBeNull();
  });
});

describe('logPricedStatuses', () => {
  test('resolves three recipients in ONE users query and emits three events with the right userId', async () => {
    const chain = usersReturn({ data: [
      { id: 'u1', phone_number: '923001112223' },
      { id: 'u2', phone_number: '923004445556' },
      { id: 'u3', phone_number: '923007778889' },
    ], error: null });
    await logPricedStatuses([
      aStatus(),
      aStatus({ id: 'wamid.B', recipient_id: '923004445556' }),
      aStatus({ id: 'wamid.C', recipient_id: '923007778889', status: 'read' }),
    ], { phoneNumberId: 'P1' });

    expect(supabase.from).toHaveBeenCalledTimes(1);
    expect(supabase.from).toHaveBeenCalledWith('users');
    expect(chain.in).toHaveBeenCalledWith('phone_number', ['923001112223', '923004445556', '923007778889']);
    expect(chain.is).toHaveBeenCalledWith('deleted_at', null);
    expect(logEvent).toHaveBeenCalledTimes(3);
    expect(logEvent.mock.calls.map((c) => [c[0], c[1].userId, c[1].wamid])).toEqual([
      ['whatsapp.status.priced', 'u1', 'wamid.A1'],
      ['whatsapp.status.priced', 'u2', 'wamid.B'],
      ['whatsapp.status.priced', 'u3', 'wamid.C'],
    ]);
  });

  test('never logs the phone number', async () => {
    usersReturn({ data: [{ id: 'u1', phone_number: '923001112223' }], error: null });
    await logPricedStatuses([aStatus()], { phoneNumberId: 'P1' });
    expect(JSON.stringify(logEvent.mock.calls)).not.toContain('923001112223');
  });

  test('an unknown recipient gets an event with no userId, and no user is created', async () => {
    const chain = usersReturn({ data: [], error: null });
    await logPricedStatuses([aStatus()], { phoneNumberId: 'P1' });
    expect(logEvent).toHaveBeenCalledTimes(1);
    expect(logEvent.mock.calls[0][1].userId).toBeUndefined();
    expect(chain.insert).toBeUndefined();
  });

  test('a foreign phone_number_id logs nothing and reads nothing', async () => {
    validators.isOurPhoneNumber.mockReturnValue(false);
    usersReturn({ data: [], error: null });
    await logPricedStatuses([aStatus()], { phoneNumberId: 'OTHER' });
    expect(validators.isOurPhoneNumber).toHaveBeenCalledWith('OTHER');
    expect(supabase.from).not.toHaveBeenCalled();
    expect(logEvent).not.toHaveBeenCalled();
  });

  test('no priced statuses: no users read', async () => {
    usersReturn({ data: [], error: null });
    await logPricedStatuses([aStatus({ status: 'sent' })], { phoneNumberId: 'P1' });
    expect(supabase.from).not.toHaveBeenCalled();
    expect(logEvent).not.toHaveBeenCalled();
  });

  test('a users-read error resolves without throwing and still logs the events without userId', async () => {
    usersReturn({ data: null, error: { message: 'boom' } });
    await expect(logPricedStatuses([aStatus()], { phoneNumberId: 'P1' })).resolves.toBeUndefined();
    expect(logEvent).toHaveBeenCalledTimes(1);
    expect(logEvent.mock.calls[0][1].userId).toBeUndefined();
  });

  test('a thrown users read resolves without throwing', async () => {
    supabase.from.mockImplementation(() => { throw new Error('down'); });
    await expect(logPricedStatuses([aStatus()], { phoneNumberId: 'P1' })).resolves.toBeUndefined();
  });
});

describe('handleStatusWebhook (the /webhook status branch)', () => {
  test('runs the broadcast update and the pricing log; a pricing failure never blocks the broadcast', async () => {
    supabase.from.mockImplementation(() => { throw new Error('down'); });
    const broadcast = jest.fn(() => Promise.resolve());
    await expect(handleStatusWebhook({ statuses: [aStatus()], phoneNumberId: 'P1' }, broadcast)).resolves.toBeUndefined();
    expect(broadcast).toHaveBeenCalledWith([aStatus()]);
  });

  test('a broadcast failure does not stop the pricing log, and does not throw', async () => {
    usersReturn({ data: [{ id: 'u1', phone_number: '923001112223' }], error: null });
    const broadcast = jest.fn(() => Promise.reject(new Error('db')));
    await expect(handleStatusWebhook({ statuses: [aStatus()], phoneNumberId: 'P1' }, broadcast)).resolves.toBeUndefined();
    expect(logEvent).toHaveBeenCalledWith('whatsapp.status.priced', expect.objectContaining({ userId: 'u1' }));
  });

  test('whatsapp-bot.js routes its status branch through handleStatusWebhook before the ack', () => {
    const src = fs.readFileSync(path.join(__dirname, '..', 'whatsapp-bot.js'), 'utf8');
    expect(src).toMatch(/await handleStatusWebhook\(statusValidation, handleBroadcastStatusWebhook\);\s*ack\(\);/);
  });
});

describe('Axiom shape: the contract the tracker APL reads (bd-9b58p pattern)', () => {
  test('event and userId are columns; wamid, status, billable, category, pricingType live in data_json', () => {
    const row = normalizeForAxiom({
      level: 'info', msg: 'whatsapp.status.priced', event: 'whatsapp.status.priced', userId: 'u1',
      wamid: 'wamid.A1', status: 'delivered', billable: true, category: 'utility', pricingModel: 'PMP', pricingType: 'regular',
    });
    expect(row.event).toBe('whatsapp.status.priced');
    expect(row.userId).toBe('u1');
    expect(row.wamid).toBeUndefined();
    expect(JSON.parse(row.data_json)).toEqual(expect.objectContaining({
      wamid: 'wamid.A1', status: 'delivered', billable: true, category: 'utility', pricingType: 'regular',
    }));
  });
});
