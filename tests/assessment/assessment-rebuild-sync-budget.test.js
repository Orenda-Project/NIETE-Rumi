/**
 * The assessment review Flow's rebuild answers inside Meta's data_exchange budget even when the
 * teacher's phone has no pacing slot free.
 *
 * `rebuildAndClose` (PICK_DONE → rebuild) AWAITS the whole rebuild inside the Flow request —
 * render, upload, and the document send — because the screen it returns says whether the paper
 * was rebuilt. Per-recipient pacing would hold that send for the phone's next slot (6 s once the
 * burst is spent), past Meta's ~10 s. The document IS the deliverable, so it is never skipped: past
 * the budget it goes out now, unpaced (what every send did before pacing), and the screen tells
 * the truth about it.
 *
 * Drives the REAL endpoint → REAL revision service → REAL WhatsApp service and pacer. Faked: the
 * network (supabase, R2, the axios stub, the Redis boundary) and the PDF renderer.
 */

const mockExam = {
  seen: { objective: { MCQs: [
    { question: 'Which is a living thing?', marks: 1 },
    { question: 'Plants make food using ____.', marks: 1 },
  ] } },
};
const mockPaper = {
  id: 'paper-1', status: 'ready', exam_json: mockExam, original_exam_json: mockExam,
  selected_question_ids: null, request_id: 'req-1',
  assessment_requests: {
    id: 'req-1', user_id: 'user-1', grade_code: 'grade_4', subject_code: 'science',
    chapter_number: 3, page_ranges: '34-41', output_format: 'pdf',
  },
};
const mockPhone = '923001110005';

jest.mock('../../bot/shared/utils/constants', () => ({
  ...jest.requireActual('../../bot/shared/utils/constants'),
  WHATSAPP_TOKEN: 'test-token',
  PHONE_NUMBER_ID: 'test-phone-id',
}));
jest.mock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn(), logError: jest.fn(), logWarn: jest.fn() }));
jest.mock('../../bot/shared/utils/html-to-pdf', () => ({ htmlToPdf: jest.fn(async () => Buffer.from('%PDF-1.4 fake')) }));
jest.mock('../../bot/shared/storage/r2', () => ({
  uploadExamBuffer: jest.fn(async () => 'exams/user-1/paper-1/Grade4_Science_Edited.pdf'),
  getPresignedUrl: jest.fn(async () => 'https://signed.example/paper.pdf'),
  buildR2PublicUrl: (k) => `https://r2.example/${k}`,
  downloadFromR2: jest.fn(),
  downloadMedia: jest.fn(),
  extractKeyFromUrl: jest.fn(),
}));
jest.mock('../../bot/shared/config/feature-flags', () => ({
  isAssessmentGeneratorEnabled: jest.fn().mockResolvedValue(true),
  isAssessmentEditingEnabled: jest.fn().mockResolvedValue(true),
  ASSESSMENT_GENERATOR_KEY: 'assessment_generator_enabled',
  ASSESSMENT_EDITING_KEY: 'assessment_editing_enabled',
}));
jest.mock('../../bot/shared/services/queue', () => ({ queueJob: jest.fn() }));

const { FakePairStore } = require('../whatsapp/helpers/fake-pair-store');
const mockStore = new FakePairStore();
const mockSession = { current: null };
jest.mock('../../bot/shared/services/cache/railway-redis.service', () => ({
  isAvailable: () => mockStore.isAvailable(),
  evalScript: (...a) => mockStore.evalScript(...a),
  get: jest.fn(async () => mockSession.current),
  set: jest.fn(async () => true),
  delete: jest.fn(async () => true),
}));


jest.mock('../../bot/shared/config/supabase', () => ({
  from: jest.fn((table) => {
    if (table === 'assessment_papers') {
      return {
        select: () => ({ eq: () => ({ maybeSingle: () => Promise.resolve({ data: mockPaper, error: null }) }) }),
        update: () => ({ eq: () => Promise.resolve({ error: null }) }),
      };
    }
    if (table === 'users') {
      return { select: () => ({ eq: () => ({ maybeSingle: () => Promise.resolve({ data: { phone_number: mockPhone, school_name: 'Test School' }, error: null }) }) }) };
    }
    return { select: () => ({ eq: () => ({ maybeSingle: () => Promise.resolve({ data: null, error: null }) }) }) };
  }),
}));

const axios = require('axios'); // mapped stub
const { logToFile } = require('../../bot/shared/utils/logger');
const pacer = require('../../bot/shared/services/whatsapp-send-pacer');
const { handleAssessmentGenDataExchange: exchange } = require('../../bot/shared/routes/assessment-gen-endpoint');

const TOKEN = 'user-1:assessment-review:paper-1';

beforeEach(() => {
  jest.useFakeTimers({ now: 1_800_000_000_000 });
  mockStore.tat.clear();
  mockStore.calls = [];
  logToFile.mockClear();
  axios.post.mockReset();
  axios.post.mockResolvedValue({ data: { messages: [{ id: 'wamid.DOC' }] }, status: 200 });
  mockSession.current = { userId: 'user-1', paperId: 'paper-1', page: 0, selected: ['seen.objective.MCQs.0'] };
  process.env.WA_PAIR_INTERVAL_MS = '6000';
  process.env.WA_PAIR_BURST = '8';
});
afterEach(() => { jest.useRealTimers(); });

test('PICK_DONE rebuild answers within the budget; the document is sent now, unpaced', async () => {
  await mockStore.fill(pacer.pairKey(mockPhone));

  const p = exchange('user-1', 'PICK_DONE', { _action: 'rebuild' }, TOKEN);
  let settled = false;
  p.then(() => { settled = true; }, () => { settled = true; });
  await jest.advanceTimersByTimeAsync(1500);

  expect(settled).toBe(true);
  const res = await p;
  expect(res.data.extension_message_response.params.assessment_action).toBe('rebuilt');
  const docs = axios.post.mock.calls.filter((c) => /\/messages$/.test(c[0]) && c[1].type === 'document');
  expect(docs).toHaveLength(1);
  expect(docs[0][1].to).toBe(mockPhone);
  const paced = logToFile.mock.calls.filter((c) => c[0] === 'whatsapp.paced').map((c) => c[1]);
  expect(paced).toEqual([expect.objectContaining({ outcome: 'unpaced', reason: 'sync_budget' })]);
});
