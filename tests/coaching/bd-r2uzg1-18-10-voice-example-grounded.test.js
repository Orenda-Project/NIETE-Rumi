'use strict';
/**
 * bd-r2uzg1.18.10 (ICT DC sheet row 69) — the voice summary praised a classroom activity that is not in
 * the teacher's recording.
 *
 * summarizeForVoiceDebrief asked for "One major strength with specific example" from a JSON dump of the
 * whole analysis, with no rule that the example must be a moment from the recording, and nothing checked
 * the script against the transcript afterwards. A read-only sample of 250 production scripts (14 days to
 * 20 Nov 2026) had about 2% praising group/pair work or a story that the transcript never mentions.
 *
 * The fix, pinned here:
 *   1. The prompt offers EXAMPLES — only the analysis's own quotes that are found in the transcript — and
 *      says the strength's example must be one of them; with none, it asks for no specific example.
 *   2. The reply comes back in parts (greeting / strength / growth / closing) so the praise can be told
 *      from a suggestion for next time.
 *   3. A script whose praise names an activity or material the recording (or her photos, or her own
 *      reflection) does not mention is rejected and written again once, with the reason; if the second
 *      draft still names one, the sentences that do are dropped before anything is spoken.
 *
 * All classroom text below is made up. Mocked at the LLM boundary only (llm-client), so the real method,
 * the real prompt and the real check run.
 */

jest.mock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn(), logError: jest.fn(), logWarn: jest.fn() }));
const mockCreate = jest.fn();
jest.mock('../../bot/shared/services/llm-client', () => ({ getClient: () => ({ chat: { completions: { create: (...a) => mockCreate(...a) } } }) }));
// The report job's other collaborators, for the one test that runs generateAndSendVoiceDebrief end to end.
jest.mock('../../bot/shared/services/whatsapp.service', () => ({
  sendMessage: jest.fn().mockResolvedValue(true),
  sendAudioFromUrl: jest.fn().mockResolvedValue(true),
}));
jest.mock('../../bot/shared/storage/r2', () => ({
  uploadVoiceDebrief: jest.fn().mockResolvedValue('https://r2.example/voice.mp3'),
  uploadReportImage: jest.fn(),
  uploadReportPDF: jest.fn(),
}));
jest.mock('../../bot/shared/services/tts', () => ({
  synthesize: jest.fn().mockResolvedValue({ audio: Buffer.alloc(32000), mimeType: 'audio/ogg', extension: 'ogg', durationSec: 2 }),
}));
jest.mock('../../bot/shared/services/coaching/coaching-helpers.service', () => ({
  determineOutputLanguage: jest.fn().mockResolvedValue('ur'),
}));
jest.mock('../../bot/shared/config/supabase', () => {
  const chain = {
    update: jest.fn(() => chain),
    select: jest.fn(() => chain),
    eq: jest.fn(() => chain),
    single: jest.fn(() => Promise.resolve({ data: { analysis_data: {} }, error: null })),
    then: (resolve) => resolve({ data: null, error: null }),
  };
  return { from: jest.fn(() => chain) };
});

const GPT5MiniService = require('../../bot/shared/services/gpt5-mini.service');

// A lesson read from the book with questions — no groups, no cards, no pictures.
const TRANSCRIPT = [
  '[00:01] Teacher (EN): Good morning class. Open your books to page twelve.',
  '[00:40] Teacher (EN): What is a noun? Who can give me an example?',
  '[00:44] Student (EN): Table is a noun.',
  '[00:47] Student (UR): کرسی بھی noun ہے۔',
  '[01:30] Teacher (UR): شاباش، اب سب مل کر پڑھیں۔',
  '[02:10] Teacher (EN): Now underline every noun in the first paragraph.',
].join('\n');

const ANALYSIS = {
  framework: 'fico',
  scores: { overall_percentage: 64 },
  strengths: [{
    title: 'Checking understanding',
    evidence: 'Teacher asked for examples. Transcript evidence: "[00:40] Teacher: \'What is a noun? Who can give me an example?\'" and students answered.',
  }],
  report_narrative: {
    moments: [
      { title: 'Asking for examples', why: 'Three children named nouns of their own.', quote: 'What is a noun?' },
      // The analysis itself can carry a line the recording does not have — it must never reach the EXAMPLES.
      { title: 'Sorting cards', why: 'Groups sorted the picture cards.', quote: 'Put the red cards in your group basket' },
    ],
  },
  growth_opportunities: [{
    area: 'Student talk',
    strategies: ['Use think-pair-share: students discuss in pairs for 30 seconds before answering.'],
  }],
};

const reply = (content) => ({ choices: [{ message: { content } }], usage: { completion_tokens: 10 } });
const parts = (p) => reply(JSON.stringify(p));
const promptOf = (i) => mockCreate.mock.calls[i][0].messages[0].content;

const INVENTED = {
  greeting: 'السلام علیکم!',
  strength: 'آج آپ کی بڑی خوبی: آپ نے بچوں کو گروپوں میں تصویری کارڈز سے کام کروایا۔ اس سے سب بچے شامل ہوئے۔',
  growth: 'اگلی بار ہر سوال کے بعد تھوڑا انتظار کریں۔',
  closing: 'آپ کی محنت کا شکریہ!',
};
const GROUNDED = {
  greeting: 'السلام علیکم!',
  strength: 'آج آپ کی بڑی خوبی: آپ نے پوچھا "What is a noun?" اور بچوں نے اپنی مثالیں دیں۔',
  growth: 'اگلی بار ہر سوال کے بعد تھوڑا انتظار کریں۔',
  closing: 'آپ کی محنت کا شکریہ!',
};

const data = (analysis = ANALYSIS) => ({ analysis, conversation: null, hasLessonPlan: false });

beforeEach(() => mockCreate.mockReset());

describe('the prompt offers only moments from the recording as examples', () => {
  test('a quote found in the transcript is offered; one the transcript lacks is not', async () => {
    mockCreate.mockResolvedValueOnce(parts(GROUNDED));
    await GPT5MiniService.summarizeForVoiceDebrief(data(), 'ur', { transcript: TRANSCRIPT });
    const p = promptOf(0);
    expect(p).toMatch(/EXAMPLES/);
    expect(p).toMatch(/"What is a noun\?"/);
    // The only place the invented line may appear is the observation dump itself, never as an offered example.
    const examples = p.slice(p.indexOf('EXAMPLES'));
    expect(examples).not.toMatch(/red cards in your group basket/);
    expect(examples).toMatch(/MUST be one of these moments/i);
    expect(examples).toMatch(/NEVER describe an activity/i);
  });

  test('with no moment the transcript confirms, it asks for no specific example', async () => {
    mockCreate.mockResolvedValueOnce(parts(GROUNDED));
    await GPT5MiniService.summarizeForVoiceDebrief(data(), 'ur', { transcript: '[00:01] Teacher (UR): السلام علیکم۔' });
    const p = promptOf(0);
    expect(p).toMatch(/no specific classroom example/i);
    expect(p).not.toMatch(/MUST be one of these moments/i);
  });

  test('the reply is asked for in four parts, as JSON', async () => {
    mockCreate.mockResolvedValueOnce(parts(GROUNDED));
    await GPT5MiniService.summarizeForVoiceDebrief(data(), 'en', { transcript: TRANSCRIPT });
    expect(promptOf(0)).toMatch(/"greeting".*"strength".*"growth".*"closing"/s);
    expect(mockCreate.mock.calls[0][0].response_format).toEqual({ type: 'json_object' });
  });
});

describe('a script that praises an activity the recording does not have is not spoken', () => {
  test('THE BUG: praise for group work with picture cards is rejected and written again', async () => {
    mockCreate.mockResolvedValueOnce(parts(INVENTED)).mockResolvedValueOnce(parts(GROUNDED));
    const script = await GPT5MiniService.summarizeForVoiceDebrief(data(), 'ur', { transcript: TRANSCRIPT });
    expect(mockCreate).toHaveBeenCalledTimes(2);
    expect(promptOf(1)).toMatch(/REJECTED/);
    expect(promptOf(1)).toMatch(/group work/);
    expect(script).not.toMatch(/کارڈ|گروپ/);
    expect(script).toMatch(/What is a noun\?/);
    // The four parts are spoken in order.
    expect(script.indexOf('السلام علیکم')).toBeLessThan(script.indexOf('What is a noun'));
    expect(script.indexOf('What is a noun')).toBeLessThan(script.indexOf('اگلی بار'));
  });

  test('if the second draft still invents it, that sentence is dropped and the rest is kept', async () => {
    mockCreate.mockResolvedValueOnce(parts(INVENTED)).mockResolvedValueOnce(parts(INVENTED));
    const script = await GPT5MiniService.summarizeForVoiceDebrief(data(), 'ur', { transcript: TRANSCRIPT });
    expect(mockCreate).toHaveBeenCalledTimes(2);
    expect(script).not.toMatch(/کارڈ|گروپ/);
    expect(script).toMatch(/اس سے سب بچے شامل ہوئے/);
    expect(script).toMatch(/اگلی بار ہر سوال کے بعد تھوڑا انتظار کریں/);
    expect(script).toMatch(/آپ کی محنت کا شکریہ/);
  });

  test('an English script is held to the same rule', async () => {
    mockCreate
      .mockResolvedValueOnce(parts({ greeting: 'Hello!', strength: 'You had the class retell the story in pairs. It was lively.', growth: 'Next time, pause after each question.', closing: 'Well done!' }))
      .mockResolvedValueOnce(parts({ greeting: 'Hello!', strength: 'You asked "What is a noun?" and children gave their own examples.', growth: 'Next time, pause after each question.', closing: 'Well done!' }));
    const script = await GPT5MiniService.summarizeForVoiceDebrief(data(), 'en', { transcript: TRANSCRIPT });
    expect(mockCreate).toHaveBeenCalledTimes(2);
    expect(script).not.toMatch(/story|pairs/);
  });
});

describe('what is NOT rejected', () => {
  test('a grounded script is spoken as written, with one call', async () => {
    mockCreate.mockResolvedValueOnce(parts(GROUNDED));
    const script = await GPT5MiniService.summarizeForVoiceDebrief(data(), 'ur', { transcript: TRANSCRIPT });
    expect(mockCreate).toHaveBeenCalledTimes(1);
    expect(script).toBe([GROUNDED.greeting, GROUNDED.strength, GROUNDED.growth, GROUNDED.closing].join('\n\n'));
  });

  test('the growth part may suggest what the report suggests (pair work), though it was not in the lesson', async () => {
    mockCreate.mockResolvedValueOnce(parts({ ...GROUNDED, growth: 'اگلی بار think-pair-share آزمائیں: بچے پہلے جوڑیوں میں بات کریں۔' }));
    await GPT5MiniService.summarizeForVoiceDebrief(data(), 'ur', { transcript: TRANSCRIPT });
    expect(mockCreate).toHaveBeenCalledTimes(1);
  });

  test('but the same pair work praised as done in this lesson is rejected', async () => {
    mockCreate
      .mockResolvedValueOnce(parts({ ...GROUNDED, strength: 'آپ نے بچوں سے جوڑیوں میں بات کروائی۔' }))
      .mockResolvedValueOnce(parts(GROUNDED));
    await GPT5MiniService.summarizeForVoiceDebrief(data(), 'ur', { transcript: TRANSCRIPT });
    expect(mockCreate).toHaveBeenCalledTimes(2);
  });

  test('a chart the teacher photographed is hers to be praised for', async () => {
    const withPhoto = { ...ANALYSIS, photo_evidence: [{ n: 1, kind: 'wall', visible_text: 'Nouns chart: person, place, thing' }] };
    mockCreate.mockResolvedValueOnce(parts({ ...GROUNDED, strength: 'Your nouns chart on the wall helped the children.' }));
    await GPT5MiniService.summarizeForVoiceDebrief(data(withPhoto), 'en', { transcript: TRANSCRIPT });
    expect(mockCreate).toHaveBeenCalledTimes(1);
  });

  test('discipline (نظم و ضبط) is not a poem, and adjective-noun pairs are not pair work', async () => {
    mockCreate.mockResolvedValueOnce(parts({ ...GROUNDED, strength: 'کلاس کا نظم و ضبط بہت اچھا تھا۔ Children made adjective-noun pairs.' }));
    await GPT5MiniService.summarizeForVoiceDebrief(data(), 'ur', { transcript: TRANSCRIPT });
    expect(mockCreate).toHaveBeenCalledTimes(1);
  });

  test('a reply that is not JSON is still spoken whole', async () => {
    mockCreate.mockResolvedValueOnce(reply('Hello! You asked "What is a noun?" today. Well done!'));
    const script = await GPT5MiniService.summarizeForVoiceDebrief(data(), 'en', { transcript: TRANSCRIPT });
    expect(script).toBe('Hello! You asked "What is a noun?" today. Well done!');
  });
});

describe('which of the analysis\'s quotes count as moments from the recording', () => {
  const { groundedMoments } = require('../../bot/shared/services/coaching/voice-grounding');

  test('a timestamped quote inside an evidence line yields its words; an apostrophe is not a quote mark', () => {
    const analysis = { strengths: [{ title: 'T', evidence: 'Teacher: "I\'ll read first." Then: "[02:10] Teacher: \'Now underline every noun in the first paragraph.\'"' }] };
    const transcript = `${TRANSCRIPT}\n[03:00] Teacher (EN): I'll read first.`;
    const quotes = groundedMoments(analysis, transcript).map((m) => m.quote);
    expect(quotes).toEqual(["I'll read first.", 'Now underline every noun in the first paragraph.']);
  });

  test('a quote cut with an ellipsis counts when each piece is in the transcript', () => {
    const analysis = { report_narrative: { moments: [{ quote: 'What is a noun? … give me an example', title: 'T' }] } };
    expect(groundedMoments(analysis, TRANSCRIPT)).toHaveLength(1);
  });

  test('nothing counts without a transcript, and at most eight are offered', () => {
    const many = { report_narrative: { moments: Array.from({ length: 12 }, () => ({ quote: 'What is a noun?' })) } };
    expect(groundedMoments(many, '')).toEqual([]);
    const lines = Array.from({ length: 12 }, (_, i) => `[00:0${i % 10}] Teacher (EN): sentence number ${i} about nouns`);
    const distinct = { report_narrative: { moments: lines.map((_, i) => ({ quote: `sentence number ${i} about nouns` })) } };
    expect(groundedMoments(distinct, lines.join('\n'))).toHaveLength(8);
  });
});

describe('the report job hands the transcript to the voice', () => {
  test('generateAndSendVoiceDebrief grounds the script in the session transcript, and speaks the grounded one', async () => {
    const ReportGenerator = require('../../bot/shared/services/coaching/report-generator.service');
    const tts = require('../../bot/shared/services/tts');
    const spy = jest.spyOn(GPT5MiniService, 'summarizeForVoiceDebrief');
    mockCreate.mockResolvedValueOnce(parts(INVENTED)).mockResolvedValueOnce(parts(GROUNDED));
    const session = {
      user_id: 'u-made-up', session_id: 's-made-up', transcript_language: 'ur', transcript_text: TRANSCRIPT,
      conversation_state: {}, users: { preferred_language: 'ur' },
    };
    await ReportGenerator.generateAndSendVoiceDebrief(session, '920000000000', 'cs-made-up', ANALYSIS, { stepAnnounced: true });
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy.mock.calls[0][2]).toEqual({ transcript: TRANSCRIPT });
    const spoken = tts.synthesize.mock.calls[0][0].text;
    expect(spoken).not.toMatch(/کارڈ|گروپ/);
    expect(spoken).toMatch(/What is a noun\?/);
    spy.mockRestore();
  });
});
