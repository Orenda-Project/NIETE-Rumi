/**
 * Delivering the register — the part that makes the month-to-date sheet real.
 * (bd-43520)
 *
 * Two rules encoded here, both learned from the Rumi original (bd-199) and from what
 * this deployment has already broken:
 *
 *  1. THE WRITE COMES FIRST, and the register is generated AFTER it, so the day just
 *     marked is in the file. Generating before the write ships a sheet that is
 *     missing the very register the principal just saved and looks like data loss.
 *
 *  2. DELIVERY CANNOT FAIL THE SAVE. R2, WhatsApp and the file system are three
 *     external things between a saved register and a delivered one. If any of them
 *     is down the attendance is still recorded, and the principal is told the save
 *     worked — because it did.
 */

const mockSupabase = { from: jest.fn() };
const mockUpload = jest.fn().mockResolvedValue('https://r2.example/register.xlsx');
const mockSendDocument = jest.fn().mockResolvedValue(true);
const mockSendMessage = jest.fn().mockResolvedValue(true);

jest.mock('../../bot/shared/config/supabase', () => mockSupabase);
jest.mock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn() }));
jest.mock('../../bot/shared/storage/r2', () => ({ uploadBuffer: mockUpload }));
jest.mock('../../bot/shared/services/whatsapp.service', () => ({
  sendDocument: mockSendDocument,
  sendMessage: mockSendMessage,
}));

const delivery = require('../../bot/shared/services/attendance-register-delivery.service');

const STAFF = [
  { id: 'u1', first_name: 'Ayesha', last_name: 'Khan' },
  { id: 'u2', first_name: 'Bilal', last_name: 'Ahmed' },
];

let captured;

function db({ records = [], school = { id: 'sch1', name: 'GGPS Dhoke Ratta' }, principal = { id: 'p1', phone_number: '923001234567' } } = {}) {
  captured = { filters: [] };
  mockSupabase.from.mockImplementation((table) => {
    if (table === 'teacher_attendance_records') {
      const chain = {
        select: () => chain,
        eq: (col, val) => { captured.filters.push([col, val]); return chain; },
        gte: (col, val) => { captured.filters.push(['gte', val]); return chain; },
        lte: (col, val) => { captured.filters.push(['lte', val]); return chain; },
        then: (res, rej) => Promise.resolve({ data: records, error: null }).then(res, rej),
      };
      return chain;
    }
    if (table === 'schools') {
      return { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: school, error: null }) }) }) };
    }
    if (table === 'users') {
      return {
        select: () => ({
          eq: () => ({
            maybeSingle: async () => ({ data: principal, error: null }),
            eq: () => ({ order: async () => ({ data: STAFF, error: null }) }),
          }),
        }),
      };
    }
    return {};
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  mockUpload.mockResolvedValue('https://r2.example/register.xlsx');
  mockSendDocument.mockResolvedValue(true);
});

describe('the happy path', () => {
  it('sends the principal an .xlsx named for their school and month', async () => {
    db({ records: [{ teacher_id: 'u1', date: '2026-08-03', status: 'present' }] });

    const result = await delivery.deliverTeacherRegister({
      principalUserId: 'p1', schoolId: 'sch1', date: '2026-08-14', staff: STAFF,
    });

    expect(result.delivered).toBe(true);
    expect(mockSendDocument).toHaveBeenCalledTimes(1);
    const [to, , filename, caption] = mockSendDocument.mock.calls[0];
    expect(to).toBe('923001234567');
    expect(filename).toBe('Teacher_Attendance_GGPS_Dhoke_Ratta_August_2026.xlsx');
    expect(caption).toContain('August 2026');
  });

  it('queries the WHOLE month, not just the day marked', async () => {
    db();
    await delivery.deliverTeacherRegister({
      principalUserId: 'p1', schoolId: 'sch1', date: '2026-08-14', staff: STAFF,
    });

    expect(captured.filters).toContainEqual(['gte', '2026-08-01']);
    expect(captured.filters).toContainEqual(['lte', '2026-08-31']);
    expect(captured.filters).toContainEqual(['school_id', 'sch1']);
  });

  it('gets February right, in a leap year and out of one', async () => {
    db();
    await delivery.deliverTeacherRegister({
      principalUserId: 'p1', schoolId: 'sch1', date: '2026-02-10', staff: STAFF,
    });
    expect(captured.filters).toContainEqual(['lte', '2026-02-28']);

    db();
    await delivery.deliverTeacherRegister({
      principalUserId: 'p1', schoolId: 'sch1', date: '2028-02-10', staff: STAFF,
    });
    expect(captured.filters).toContainEqual(['lte', '2028-02-29']);
  });

  it('keeps a copy in R2, under the school and month', async () => {
    db();
    await delivery.deliverTeacherRegister({
      principalUserId: 'p1', schoolId: 'sch1', date: '2026-08-14', staff: STAFF,
    });

    expect(mockUpload).toHaveBeenCalledTimes(1);
    const key = mockUpload.mock.calls[0][1];
    expect(key).toContain('sch1');
    expect(key).toContain('2026');
    expect(key).toMatch(/\.xlsx$/);
  });
});

describe('delivery never breaks the save', () => {
  it('reports not-delivered when WhatsApp refuses, without throwing', async () => {
    db();
    mockSendDocument.mockRejectedValue(new Error('media upload failed'));

    const result = await delivery.deliverTeacherRegister({
      principalUserId: 'p1', schoolId: 'sch1', date: '2026-08-14', staff: STAFF,
    });

    expect(result.delivered).toBe(false);
    expect(result.error).toMatch(/media upload failed/);
  });

  it('still sends the document when R2 is down — the file is the deliverable', async () => {
    db();
    mockUpload.mockRejectedValue(new Error('r2 unreachable'));

    const result = await delivery.deliverTeacherRegister({
      principalUserId: 'p1', schoolId: 'sch1', date: '2026-08-14', staff: STAFF,
    });

    expect(mockSendDocument).toHaveBeenCalledTimes(1);
    expect(result.delivered).toBe(true);
  });

  it('does not throw when the principal has no phone number on file', async () => {
    db({ principal: { id: 'p1', phone_number: null } });

    const result = await delivery.deliverTeacherRegister({
      principalUserId: 'p1', schoolId: 'sch1', date: '2026-08-14', staff: STAFF,
    });

    expect(result.delivered).toBe(false);
    expect(mockSendDocument).not.toHaveBeenCalled();
  });

  it('loads the roster itself when the caller does not pass one', async () => {
    db();
    const result = await delivery.deliverTeacherRegister({
      principalUserId: 'p1', schoolId: 'sch1', date: '2026-08-14',
    });
    expect(result.delivered).toBe(true);
  });
});
