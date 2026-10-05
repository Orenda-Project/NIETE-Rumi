/**
 * Two schools, one file name, one upload each — and each principal gets THEIR register.
 * (bd-c00np)
 *
 * The register's file name carries no school: "Grade 5 A, September 2026" is the same
 * name everywhere, and a staff register is named for the school's NAME, which two
 * schools can share. Delivery used to write the buffer to TEMP_DIR/<fileName> and hand
 * that path to WhatsAppService.sendDocument, which opens a read stream that is only
 * consumed when the HTTP upload body goes out. A second delivery with the same name
 * that wrote in between overwrote the file, and the first principal was sent the
 * second school's register — names and attendance of children at another school —
 * while both deliveries logged success.
 *
 * Exercised through the REAL deliverRegister and the REAL WhatsAppService.sendDocument
 * (so the real fs.createReadStream runs); only the network is faked: the Graph API
 * media upload waits 200 ms (DNS/TLS) before it reads the stream it was given.
 */

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const mockSupabase = { from: jest.fn() };
const mockUpload = jest.fn();

jest.mock('../../bot/shared/config/supabase', () => mockSupabase);
jest.mock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn(), logError: jest.fn() }));
jest.mock('../../bot/shared/storage/r2', () => ({
  uploadBuffer: mockUpload,
  downloadFromR2: jest.fn(),
  downloadMedia: jest.fn(),
  extractKeyFromUrl: jest.fn(),
}));
jest.mock('../../bot/shared/utils/constants', () => {
  const real = jest.requireActual('../../bot/shared/utils/constants');
  const os = require('os');
  const p = require('path');
  const f = require('fs');
  return {
    ...real,
    WHATSAPP_TOKEN: 'test-token',
    PHONE_NUMBER_ID: 'test-phone-id',
    TEMP_DIR: f.mkdtempSync(p.join(os.tmpdir(), 'register-race-')),
  };
});
// The multipart body: keep what was appended so the faked upload can read the stream
// the way the real form-data does — when the request body is written, not before.
jest.mock('form-data', () => class RecordingFormData {
  constructor() { this.parts = []; }
  append(name, value, options) { this.parts.push({ name, value, options }); }
  getHeaders() { return { 'content-type': 'multipart/form-data; boundary=x' }; }
});

const axios = require('axios'); // mapped stub — the network boundary
const { logToFile } = require('../../bot/shared/utils/logger');
const { TEMP_DIR } = require('../../bot/shared/utils/constants');
const delivery = require('../../bot/shared/services/attendance-register-delivery.service');

const sha12 = (buf) => crypto.createHash('sha256').update(buf).digest('hex').slice(0, 12);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const SCHOOLS = {
  schA: { principal: { id: 'pA', phone_number: '923000000001' }, staff: [{ id: 'a1', name: 'Ayesha Khan' }, { id: 'a2', name: 'Bilal Ahmed' }] },
  schB: { principal: { id: 'pB', phone_number: '923000000002' }, staff: [{ id: 'b1', name: 'Zainab Raza' }, { id: 'b2', name: 'Usman Tariq' }, { id: 'b3', name: 'Hina Shah' }] },
};
const PRINCIPALS = { pA: SCHOOLS.schA.principal, pB: SCHOOLS.schB.principal };

function db() {
  mockSupabase.from.mockImplementation((table) => {
    if (table === 'teacher_attendance_records') {
      const chain = {
        select: () => chain, eq: () => chain, gte: () => chain, lte: () => chain,
        then: (res, rej) => Promise.resolve({ data: [], error: null }).then(res, rej),
      };
      return chain;
    }
    if (table === 'schools') {
      // Two different schools that share a name — so their registers share a file name.
      return { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { name: 'GGPS Model School' }, error: null }) }) }) };
    }
    if (table === 'users') {
      return {
        select: () => ({
          eq: (_col, val) => ({
            maybeSingle: async () => ({ data: PRINCIPALS[val] || null, error: null }),
            eq: () => ({ order: async () => ({ data: [], error: null }) }),
          }),
        }),
      };
    }
    return {};
  });
}

/** What each recipient was actually sent: bytes read off the upload stream, joined to `to` by media id. */
let uploads;
let sends;

function fakeGraphApi({ uploadDelayMs = 200 } = {}) {
  uploads = new Map();
  sends = [];
  let n = 0;
  axios.post.mockReset();
  axios.post.mockImplementation(async (url, body) => {
    if (/\/media$/.test(url)) {
      const id = `media-${++n}`;
      await sleep(uploadDelayMs); // connect to graph.facebook.com before the body is streamed
      const file = body.parts.find((p) => p.name === 'file').value;
      const chunks = [];
      for await (const chunk of file) chunks.push(chunk);
      uploads.set(id, Buffer.concat(chunks));
      return { status: 200, data: { id } };
    }
    if (/\/messages$/.test(url)) {
      sends.push({ to: body.to, mediaId: body.document && body.document.id, filename: body.document && body.document.filename });
      return { status: 200, data: { messages: [{ id: `wamid.${sends.length}` }] } };
    }
    return { status: 200, data: {} };
  });
}

/** The buffer generated for each school, as archived to R2 (key carries the school id). */
function generatedFor(schoolId) {
  const call = mockUpload.mock.calls.find((c) => c[1].includes(`/${schoolId}/`));
  return call && call[0];
}

beforeEach(() => {
  jest.clearAllMocks();
  mockUpload.mockResolvedValue('https://r2.example/register.xlsx');
  db();
  fakeGraphApi();
});

afterAll(() => { try { fs.rmSync(TEMP_DIR, { recursive: true, force: true }); } catch { /* best effort */ } });

const deliverFor = (schoolId) => delivery.deliverTeacherRegister({
  principalUserId: SCHOOLS[schoolId].principal.id, schoolId, date: '2026-09-14', staff: SCHOOLS[schoolId].staff,
});

describe('two deliveries with the same file name at the same time', () => {
  it('sends each principal the register generated for their own school', async () => {
    const [a, b] = await Promise.all([deliverFor('schA'), deliverFor('schB')]);

    expect(a.delivered).toBe(true);
    expect(b.delivered).toBe(true);
    // Precondition of the race: one name for both files, different contents.
    expect(a.fileName).toBe(b.fileName);
    const bufA = generatedFor('schA');
    const bufB = generatedFor('schB');
    expect(Buffer.compare(bufA, bufB)).not.toBe(0);

    expect(sends).toHaveLength(2);
    const received = Object.fromEntries(sends.map((s) => [s.to, uploads.get(s.mediaId)]));
    // The display name the principal sees is unchanged.
    expect(sends.map((s) => s.filename)).toEqual([a.fileName, a.fileName]);
    expect(sha12(received['923000000001'])).toBe(sha12(bufA));
    expect(sha12(received['923000000002'])).toBe(sha12(bufB));
  });

  it('leaves nothing behind in the temp directory', async () => {
    await Promise.all([deliverFor('schA'), deliverFor('schB')]);
    expect(fs.readdirSync(TEMP_DIR)).toEqual([]);
  });
});

describe('the delivery log says which bytes went out', () => {
  it('logs a short sha256 of the generated buffer and of the uploaded file — and no phone number', async () => {
    fakeGraphApi({ uploadDelayMs: 0 });
    const result = await deliverFor('schA');
    expect(result.delivered).toBe(true);

    const line = logToFile.mock.calls.find((c) => c[0] === '✅ Register delivered');
    expect(line).toBeDefined();
    const expected = sha12(generatedFor('schA'));
    expect(line[1].bufferSha256).toBe(expected);
    expect(line[1].fileSha256).toBe(expected);
    expect(line[1].bufferSha256).toMatch(/^[0-9a-f]{12}$/);
    expect(JSON.stringify(line[1])).not.toContain('923000000001');
  });
});
