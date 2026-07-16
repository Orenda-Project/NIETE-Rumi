/**
 * PDF-module delivery via WhatsApp — content-delivery routing.
 *
 * Covers:
 *   1. deliverPdfModule sends the PDF via WhatsApp sendDocumentByLink using
 *      module.source_media_url, filename = "<title>.pdf", caption = title.
 *   2. deliverPdfModule fires the semantic event
 *      `training_pdf_module_delivered` with {module_id, user_id, vendor_key?}.
 *   3. Fallback: source_media_url IS NULL → text "PDF not available yet",
 *      does not call sendDocumentByLink.
 *   4. WhatsApp API error (sendDocumentByLink returns false) → logs, returns
 *      false; does NOT throw.
 *   5. Routing: deliverModuleById routes a module with video_url NULL and
 *      source_media_url present to the PDF path (not the video/link path).
 *      A module with video_url present still uses the video path.
 */

let ContentDelivery;
let supabaseFrom;
let whatsappSend;
let whatsappDocumentByLink;
let whatsappInteractive;
let whatsappButtons;
let logEventMock;
let tableStates;

function makeChain(tableName) {
  const state = tableStates[tableName] || {};
  const record = { table: tableName, filters: {}, orderCol: null, orderDir: null, isCount: false, mutation: null };
  const chain = {};
  const finalize = () => {
    if (record.mutation && !record._mutationTracked) {
      state._mutations = state._mutations || [];
      state._mutations.push(record.mutation);
      record._mutationTracked = true;
    }
    if (record.isCount) {
      const count = typeof state.count === 'function' ? state.count(record.filters) : (state.count ?? 0);
      return { count, data: null, error: null };
    }
    if (state.error) return { data: null, error: state.error };
    const rows = typeof state.rows === 'function' ? state.rows(record.filters) : (state.rows || []);
    return { data: rows[0] || null, error: null };
  };
  const finalizeMany = () => {
    if (record.mutation && !record._mutationTracked) {
      state._mutations = state._mutations || [];
      state._mutations.push(record.mutation);
      record._mutationTracked = true;
    }
    if (record.isCount) {
      const count = typeof state.count === 'function' ? state.count(record.filters) : (state.count ?? 0);
      return { count, data: null, error: null };
    }
    if (state.error) return { data: null, error: state.error };
    const rows = typeof state.rows === 'function' ? state.rows(record.filters) : (state.rows || []);
    return { data: rows, error: null };
  };

  chain.select = jest.fn((_cols, opts) => {
    if (opts && opts.count === 'exact' && opts.head === true) record.isCount = true;
    return chain;
  });
  chain.insert = jest.fn((payload) => { record.mutation = { op: 'insert', payload }; return chain; });
  chain.update = jest.fn((payload) => { record.mutation = { op: 'update', payload }; return chain; });
  chain.upsert = jest.fn((payload, opts) => { record.mutation = { op: 'upsert', payload, opts }; return chain; });
  ['eq', 'neq', 'gt', 'gte', 'lt', 'lte', 'like', 'ilike', 'is', 'contains', 'not'].forEach((m) => {
    chain[m] = jest.fn((col, val) => { record.filters[col] = val; return chain; });
  });
  chain.in = jest.fn((col, vals) => { record.filters[col] = { in: vals }; return chain; });
  chain.filter = jest.fn(() => chain);
  chain.order = jest.fn((col, opts) => { record.orderCol = col; record.orderDir = opts?.ascending ? 'asc' : 'desc'; return chain; });
  chain.limit = jest.fn(() => chain);
  chain.range = jest.fn(() => chain);
  chain.single = jest.fn(async () => finalize());
  chain.maybeSingle = jest.fn(async () => finalize());
  chain.then = (resolve, reject) => Promise.resolve(finalizeMany()).then(resolve, reject);
  return chain;
}

beforeEach(() => {
  jest.resetModules();
  tableStates = {};

  jest.doMock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn() }));
  logEventMock = jest.fn();
  jest.doMock('../../bot/shared/utils/structured-logger', () => ({
    logEvent: logEventMock,
    getCurrentCorrelationId: () => null,
    logger: { info: jest.fn(), error: jest.fn(), warn: jest.fn() },
  }));

  supabaseFrom = jest.fn((tbl) => makeChain(tbl));
  jest.doMock('../../bot/shared/config/supabase', () => ({
    from: supabaseFrom,
    rpc: jest.fn().mockResolvedValue({ error: null }),
  }));

  whatsappSend = jest.fn().mockResolvedValue(true);
  whatsappDocumentByLink = jest.fn().mockResolvedValue(true);
  whatsappInteractive = jest.fn().mockResolvedValue(true);
  whatsappButtons = jest.fn().mockResolvedValue(true);
  jest.doMock('../../bot/shared/services/whatsapp.service', () => ({
    sendMessage: whatsappSend,
    sendDocumentByLink: whatsappDocumentByLink,
    sendInteractiveMessage: whatsappInteractive,
    sendInteractiveButtons: whatsappButtons,
  }));

  jest.doMock('../../bot/shared/storage/r2', () => ({
    getPresignedUrl: jest.fn().mockResolvedValue('https://r2.example.com/signed'),
  }));

  ContentDelivery = require('../../bot/shared/services/training/content-delivery.service');
});

afterEach(() => jest.resetModules());

describe('deliverPdfModule — direct unit', () => {
  it('sends the PDF via sendDocumentByLink with the right URL, filename, and caption', async () => {
    const module = {
      id: 180,
      title: 'What is AI?',
      source_media_url: 'https://asset-manager-approved.s3.ap-south-1.amazonaws.com/abc.pdf',
    };
    const ok = await ContentDelivery.deliverPdfModule('9203206281951', module, { userId: 'user-1' });
    expect(ok).toBe(true);
    expect(whatsappDocumentByLink).toHaveBeenCalledTimes(1);
    const [to, url, filename, caption] = whatsappDocumentByLink.mock.calls[0];
    expect(to).toBe('9203206281951');
    expect(url).toBe(module.source_media_url);
    expect(filename).toBe('What is AI?.pdf');
    expect(caption).toBe('What is AI?');
  });

  it('emits training_pdf_module_delivered event with module_id + user_id', async () => {
    const module = {
      id: 180,
      title: 'What is AI?',
      source_media_url: 'https://asset-manager-approved.s3.ap-south-1.amazonaws.com/abc.pdf',
    };
    await ContentDelivery.deliverPdfModule('9203206281951', module, { userId: 'user-1', vendorKey: 'beacon_house' });
    const event = logEventMock.mock.calls.find(c => c[0] === 'training_pdf_module_delivered');
    expect(event).toBeTruthy();
    expect(event[1]).toEqual(expect.objectContaining({
      module_id: 180,
      user_id: 'user-1',
      vendor_key: 'beacon_house',
    }));
  });

  it('falls back to text "PDF not available yet" when source_media_url is null', async () => {
    const module = { id: 999, title: 'Broken', source_media_url: null };
    const ok = await ContentDelivery.deliverPdfModule('9203206281951', module, { userId: 'user-1' });
    expect(ok).toBe(false);
    expect(whatsappDocumentByLink).not.toHaveBeenCalled();
    expect(whatsappSend).toHaveBeenCalled();
    const [, textBody] = whatsappSend.mock.calls[0];
    expect(textBody.toLowerCase()).toContain('pdf');
    expect(textBody.toLowerCase()).toContain('not available');
  });

  it('returns false and logs (does not throw) when WhatsApp API errors', async () => {
    whatsappDocumentByLink.mockResolvedValue(false);
    const module = {
      id: 180,
      title: 'What is AI?',
      source_media_url: 'https://asset-manager-approved.s3.ap-south-1.amazonaws.com/abc.pdf',
    };
    let threw = false;
    let ok;
    try {
      ok = await ContentDelivery.deliverPdfModule('9203206281951', module, { userId: 'user-1' });
    } catch (_e) { threw = true; }
    expect(threw).toBe(false);
    expect(ok).toBe(false);
  });
});

describe('routing — video vs pdf', () => {
  it('deliverModuleById routes a PDF module (video_url NULL, source_media_url set) to sendDocumentByLink', async () => {
    tableStates.training_modules = {
      rows: [{
        id: 180,
        course_id: 7,
        title: 'What is AI?',
        video_url: null,
        source_media_url: 'https://asset-manager-approved.s3.ap-south-1.amazonaws.com/abc.pdf',
        order_index: 1,
      }],
    };
    tableStates.training_courses = { rows: [{ id: 7, title: 'BH English L1' }] };
    tableStates.teacher_training_progress = { rows: [] };

    await ContentDelivery.deliverModuleById(180, '9203206281951', { userId: 'user-1' });

    expect(whatsappDocumentByLink).toHaveBeenCalledTimes(1);
    const [, url] = whatsappDocumentByLink.mock.calls[0];
    expect(url).toBe('https://asset-manager-approved.s3.ap-south-1.amazonaws.com/abc.pdf');
  });

  it('deliverModuleById routes a VIDEO module (video_url present) to the existing video/link path (no sendDocumentByLink)', async () => {
    tableStates.training_modules = {
      rows: [{
        id: 179,
        course_id: 7,
        title: 'AI Is a Teaching Assistant',
        video_url: 'training/videos/179.mp4',
        source_media_url: 'https://asset-manager-approved.s3.ap-south-1.amazonaws.com/xyz.mp4',
        order_index: 1,
      }],
    };
    tableStates.training_courses = { rows: [{ id: 7, title: 'BH English L1' }] };
    tableStates.teacher_training_progress = { rows: [] };

    await ContentDelivery.deliverModuleById(179, '9203206281951', { userId: 'user-1' });

    expect(whatsappDocumentByLink).not.toHaveBeenCalled();
    // Existing path uses sendMessage with the presigned link
    expect(whatsappSend).toHaveBeenCalled();
  });
});
