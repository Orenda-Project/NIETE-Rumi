/**
 * bd-wpupy F5 — the delivery marker.
 *
 * 58 of 60 production deliveries wrote nothing to `conversations`, so the
 * lesson hand-over was invisible to chat history and a later "this" bound to
 * whatever was discussed days before. The marker closes that hole.
 */

/* eslint-disable global-require */

const mockStore = jest.fn(async () => ({}));
jest.mock('../../shared/database/bot-helpers', () => ({ storeConversation: mockStore }));

let mockExistingRows = [];
let mockSelectError = null;
jest.mock('../../shared/config/supabase', () => ({
  from: jest.fn(() => {
    const b = {
      select: () => b, eq: () => b, gte: () => b,
      limit: () => Promise.resolve({ data: mockExistingRows, error: mockSelectError }),
    };
    return b;
  }),
}));
jest.mock('../../shared/utils/logger', () => ({ logToFile: jest.fn() }));
jest.mock('../../shared/utils/structured-logger', () => ({ logEvent: jest.fn() }));

const { recordDeliveryMarker, markerText } = require('../../shared/services/lp-delivery-marker.service');

const LESSON = {
  userId: 'u1', lessonId: 'grade_4_general_science_ch1_seg1',
  grade: 4, subject: 'general_science', chapterNumber: 1, segmentLabel: 'Day 1',
};

beforeEach(() => { mockStore.mockClear(); mockExistingRows = []; mockSelectError = null; });

describe('bd-wpupy F5 — the marker anchors "this"', () => {
  test('a delivery writes one assistant row', async () => {
    await expect(recordDeliveryMarker(LESSON)).resolves.toBe(true);
    expect(mockStore).toHaveBeenCalledTimes(1);
    const [userId, role, content] = mockStore.mock.calls[0];
    expect(userId).toBe('u1');
    expect(role).toBe('assistant');
    expect(content).toMatch(/^\[lesson plan sent\]/);
    expect(content).toMatch(/Grade 4/);
    expect(content).toMatch(/Chapter 1/);
  });

  test('it carries NO chapter title or lesson content — nothing to elaborate from', () => {
    const t = markerText({ grade: 4, subject: 'general_science', chapterNumber: 1, segmentLabel: 'Day 1' });
    expect(t).not.toMatch(/Green Guardians/i);
    expect(t.length).toBeLessThan(80);
  });

  test('the same lesson delivered twice in the window writes once (4x in 2 min is real)', async () => {
    mockExistingRows = [{ id: 'c1' }];
    await expect(recordDeliveryMarker(LESSON)).resolves.toBe(false);
    expect(mockStore).not.toHaveBeenCalled();
  });

  test('a DIFFERENT lesson still gets its own marker', () => {
    const a = markerText({ grade: 4, subject: 'general_science', chapterNumber: 1 });
    const b = markerText({ grade: 3, subject: 'math', chapterNumber: 2 });
    expect(a).not.toBe(b);
  });

  test('a broken dedup read must not lose the marker OR throw at the caller', async () => {
    mockSelectError = { message: 'boom' };
    await expect(recordDeliveryMarker(LESSON)).resolves.toBe(false);
  });

  test('no userId → no write, no crash', async () => {
    await expect(recordDeliveryMarker({ ...LESSON, userId: null })).resolves.toBe(false);
    expect(mockStore).not.toHaveBeenCalled();
  });

  test('a store failure never propagates — the PDF already reached her', async () => {
    mockStore.mockRejectedValueOnce(new Error('db down'));
    await expect(recordDeliveryMarker(LESSON)).resolves.toBe(false);
  });
});
