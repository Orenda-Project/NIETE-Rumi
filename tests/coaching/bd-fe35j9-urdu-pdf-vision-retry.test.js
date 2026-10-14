/**
 * bd-fe35j9 — a typed Urdu lesson-plan PDF is rejected as "not a lesson plan",
 * so Section B (fidelity) is never scored.
 *
 * Prod, ICT, 12-Oct (session e6863a75): a coach uploaded our own Grade 1 Urdu LP
 * (GRADE_1_URDU_CH6_SEG6) as a PDF. pdf-parse returned 28,875 chars — enough to
 * skip the vision path — but the Urdu came out as broken glyphs and NUL bytes.
 * The parser read that as "not a lesson plan", the coach was told so, and
 * Section B was excluded. Same PDF through the vision model reads cleanly and
 * classifies as a lesson plan. 22 of the 36 stuck PDF uploads in the 30 days to
 * 13-Oct were Urdu LPs.
 *
 * Contract: before a FILE is rejected as not-a-lesson-plan, it gets one second
 * read through the vision model (unless the vision model already read it). Only
 * if that read is also not a lesson plan is the teacher told so.
 */

process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'http://localhost';
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'test-key';
process.env.OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY || 'test-key';
process.env.OPENAI_API_KEY = process.env.OPENAI_API_KEY || 'test-key';

// What pdf-parse actually returned for the 12-Oct PDF (first bytes, verbatim shape).
const GARBLED_TEXT_LAYER = '· اردو۱ \n\u0000\n\u0000\n\u0000\nام\n\u0000\nؕ\n\u0000\n ۴۰ ·  ۵۵-۵۶ ہ \nح\n\u0000\nا اور\n'.repeat(40);
const VISION_TEXT = 'جماعت ۱ اردو\nتصویری جملے - تصاویر کو عنوان دینا اور جملے لکھنا\nمقاصد: ...\nسرگرمی: ...';
const NOT_LP = { is_lesson_plan: false, subject: '', objectives: [] };
const URDU_LP = { is_lesson_plan: true, subject: 'اردو', topic: 'تصویری جملے', objectives: ['x'], activities: [{ title: 'y' }] };

describe('bd-fe35j9 · extraction worker retries a rejected file through the vision model', () => {
  let updates; let visionCalls;

  function load({ visionText = VISION_TEXT } = {}) {
    jest.resetModules();
    updates = []; visionCalls = [];
    jest.doMock('../../bot/shared/config/supabase', () => ({
      from: (table) => {
        const b = {
          select: () => b, eq: () => b,
          single: async () => ({ data: { user_id: 'teacher-1', lesson_plan_url: 'u', lesson_plan_r2_key: 'lesson_plans/t/s_lesson_plan.pdf', lesson_plan_format: 'pdf' }, error: null }),
          maybeSingle: async () => ({ data: { user_id: 'teacher-1' }, error: null }),
          update: (payload) => { updates.push({ table, payload }); return b; },
        };
        return b;
      },
    }));
    jest.doMock('../../bot/shared/storage/r2', () => ({
      downloadFromR2: async () => Buffer.from('%PDF-1.4 fake'),
      uploadLessonPlanBuffer: async () => 'k', buildR2PublicUrl: () => 'u',
    }));
    jest.doMock('../../bot/shared/services/whatsapp.service', () => ({ sendMessage: jest.fn(async () => true) }));
    jest.doMock('../../bot/shared/services/lp-vision-ocr.service', () => ({
      extractTextFromPdf: async (buf) => { visionCalls.push({ kind: 'pdf', buf }); return visionText; },
      extractTextFromImage: async (buf) => { visionCalls.push({ kind: 'image', buf }); return visionText; },
      visionModel: () => 'test-vision',
    }));
    const Worker = require('../../bot/workers/lesson-plan-extraction.worker');
    const notify = jest.spyOn(Worker, 'notifyNotLessonPlan').mockResolvedValue();
    const recompute = jest.spyOn(Worker, 'maybeRecomputeFidelity').mockResolvedValue({ recomputed: true });
    return { Worker, notify, recompute };
  }

  afterEach(() => {
    jest.dontMock('../../bot/shared/config/supabase');
    jest.dontMock('../../bot/shared/storage/r2');
    jest.dontMock('../../bot/shared/services/whatsapp.service');
    jest.dontMock('../../bot/shared/services/lp-vision-ocr.service');
    jest.restoreAllMocks();
    jest.resetModules();
  });

  it('rescues a typed Urdu PDF whose text layer is garbled', async () => {
    const { Worker, notify, recompute } = load();
    jest.spyOn(Worker, 'extractText').mockResolvedValue({ text: GARBLED_TEXT_LAYER, parser: 'pdf-parse' });
    const parse = jest.spyOn(Worker, 'parseWithGPT4oMini')
      .mockResolvedValueOnce(NOT_LP)
      .mockResolvedValueOnce(URDU_LP);

    await Worker.process({ coachingSessionId: 'sess-1', r2Key: 'lesson_plans/t/s_lesson_plan.pdf', fileType: 'pdf', userId: 'teacher-1' });

    expect(visionCalls).toHaveLength(1);
    expect(visionCalls[0].kind).toBe('pdf');
    expect(parse).toHaveBeenLastCalledWith(VISION_TEXT);
    expect(notify).not.toHaveBeenCalled();
    expect(updates.find((u) => u.payload.lesson_plan_extraction_status === 'not_lesson_plan')).toBeUndefined();
    const completed = updates.find((u) => u.payload.lesson_plan_extraction_status === 'completed');
    expect(completed).toBeTruthy();
    expect(completed.payload).toMatchObject({ lesson_plan_text: VISION_TEXT, lesson_plan_structured: URDU_LP });
    expect(recompute).toHaveBeenCalledWith('sess-1');
  });

  it('still rejects a file the vision model also says is not a lesson plan', async () => {
    const { Worker, notify } = load({ visionText: 'Respected Principal, I request leave for two days.' });
    jest.spyOn(Worker, 'extractText').mockResolvedValue({ text: 'Respected Principal, I request leave for two days. '.repeat(3), parser: 'pdf-parse' });
    jest.spyOn(Worker, 'parseWithGPT4oMini').mockResolvedValue(NOT_LP);

    await Worker.process({ coachingSessionId: 'sess-1', r2Key: 'k.pdf', fileType: 'pdf', userId: 'teacher-1' });

    expect(visionCalls).toHaveLength(1);
    expect(notify).toHaveBeenCalledTimes(1);
    expect(updates.find((u) => u.payload.lesson_plan_extraction_status === 'not_lesson_plan')).toBeTruthy();
  });

  it('does not send pasted text to the vision model — there is no file', async () => {
    const { Worker, notify } = load();
    jest.spyOn(Worker, 'parseWithGPT4oMini').mockResolvedValue(NOT_LP);

    await Worker.process({ coachingSessionId: 'sess-1', pastedText: 'Respected Principal, I request leave for two days due to illness at home.', userId: 'teacher-1' });

    expect(visionCalls).toEqual([]);
    expect(notify).toHaveBeenCalledTimes(1);
  });

  it('does not read a file twice when the vision model already read it', async () => {
    const { Worker, notify } = load();
    jest.spyOn(Worker, 'extractText').mockResolvedValue({ text: VISION_TEXT + ' '.repeat(60), parser: 'vision:pdf_low_text' });
    jest.spyOn(Worker, 'parseWithGPT4oMini').mockResolvedValue(NOT_LP);

    await Worker.process({ coachingSessionId: 'sess-1', r2Key: 'k.pdf', fileType: 'pdf', userId: 'teacher-1' });

    expect(visionCalls).toEqual([]);
    expect(notify).toHaveBeenCalledTimes(1);
  });
});
