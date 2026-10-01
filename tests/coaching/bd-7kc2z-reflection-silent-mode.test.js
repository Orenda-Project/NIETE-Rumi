/**
 * bd-7kc2z — the reflective debrief, driven from the PORTAL instead of WhatsApp.
 *
 * A teacher who self-records in the portal has no chat thread to answer in, and
 * the operator's instruction is that a portal-originated session stays SILENT on
 * WhatsApp. So the reflection engine grows a second caller, not a second
 * implementation: same v12 question generation, same conversation_state shape,
 * same language lock, same report gating — only the transport is suppressed and
 * the text is RETURNED instead of spoken.
 *
 * These tests exist to pin the "do not change the logic" constraint. The
 * WhatsApp assertions are the important half: they must keep passing untouched,
 * byte-for-byte, or the refactor has broken the live path.
 *
 * NOTE: NIETE asks ONE reflective question per observation
 * (NUM_REFLECTIVE_QUESTIONS = 1, deliberately reduced from 3), so answering the
 * first question completes the debrief and queues the report.
 */

const SERVICE = '../../bot/shared/services/coaching/reflective-conversation.service';

const QUESTION = 'You paused after Ayesha answered — what were you weighing up?';
const ACK = 'That pause gave her room to think.';

/** Chainable PostgREST double over a single coaching_sessions row. */
function supabaseFor(row, captured) {
  const q = {
    from: () => q,
    select: () => q,
    eq: () => q,
    update: (patch) => { if (captured) captured.push(patch); return q; },
    single: async () => ({ data: row, error: null }),
    maybeSingle: async () => ({ data: row, error: null }),
  };
  return q;
}

describe('bd-7kc2z — reflective debrief in silent (portal) mode', () => {
  let sendAudio;
  let sendMessage;
  let generateSpeech;
  let queueReport;
  let stateWrites;

  function arrange(row) {
    jest.resetModules();
    stateWrites = [];

    sendAudio = jest.fn().mockResolvedValue(undefined);
    sendMessage = jest.fn().mockResolvedValue(undefined);
    generateSpeech = jest.fn().mockResolvedValue({ audio: Buffer.from('spoken') });
    queueReport = jest.fn().mockResolvedValue(undefined);

    jest.doMock('../../bot/shared/config/supabase', () => supabaseFor(row));
    jest.doMock('../../bot/shared/services/whatsapp.service', () => ({
      sendAudio, sendMessage, downloadMedia: jest.fn(),
    }));
    // NIETE voices through shared/services/tts (NOT elevenlabs.service directly —
    // that is the upstream bot's shape). synthesize() resolves { audio }.
    jest.doMock('../../bot/shared/services/tts', () => ({
      synthesize: generateSpeech,
    }));
    jest.doMock('../../bot/shared/services/coaching/coaching-job-queue.service', () => ({
      queueReport, queueTranscription: jest.fn(), queueAnalysis: jest.fn(),
    }));
    jest.doMock('../../bot/shared/services/coaching/coaching-session.service', () => ({
      updateConversationState: jest.fn(async (_id, st) => { stateWrites.push(st); }),
      updateStatus: jest.fn().mockResolvedValue(undefined),
    }));
    jest.doMock('../../bot/shared/utils/language-cache', () => ({
      getUserLanguage: jest.fn().mockResolvedValue('ur'),
      setUserLanguage: jest.fn(),
      isUserLanguageLocked: jest.fn().mockResolvedValue(false),
    }));
    jest.doMock('../../bot/shared/services/gpt5-mini.service', () => ({
      _generateReflectiveQuestionV12: jest.fn().mockResolvedValue(QUESTION),
      generateReflectiveQuestion: jest.fn().mockResolvedValue(QUESTION),
      openai: { chat: { completions: { create: jest.fn().mockResolvedValue({
        choices: [{ message: { content: ACK } }],
      }) } } },
    }));
    jest.doMock('../../bot/shared/services/coaching/reflective-acknowledgement', () => ({
      generateAcknowledgement: jest.fn().mockResolvedValue(ACK),
    }));

    return require(SERVICE);
  }

  const freshRow = () => ({
    user_id: 'u-1',
    transcript_text: 'a lesson',
    analysis_data: { reflective_corpus: { moments: ['a pause'] }, teacherFirstName: 'Sana' },
    conversation_state: { current_state: 'ANALYSIS_COMPLETE', questions: [], questions_answered: 0 },
  });

  const answeringRow = () => ({
    user_id: 'u-1',
    conversation_state: {
      current_state: 'REFLECTIVE_QUESTION_1',
      conversation_language: 'ur',
      questions: [{ question_number: 1, question: QUESTION, answer: null }],
      questions_answered: 0,
    },
  });

  describe('asking the question', () => {
    test('silent mode returns the question and sends nothing to WhatsApp', async () => {
      const Svc = arrange(freshRow());

      const result = await Svc.conductReflectiveConversation('cs-1', null, 1, { silent: true });

      expect(result).toMatchObject({ question: QUESTION, questionNumber: 1 });
      expect(sendAudio).not.toHaveBeenCalled();
      expect(sendMessage).not.toHaveBeenCalled();
      expect(generateSpeech).not.toHaveBeenCalled();
    });

    test('silent mode still writes the SAME conversation_state the WhatsApp path does', async () => {
      const Svc = arrange(freshRow());

      await Svc.conductReflectiveConversation('cs-1', null, 1, { silent: true });

      const last = stateWrites[stateWrites.length - 1];
      expect(last.current_state).toBe('REFLECTIVE_QUESTION_1');
      expect(last.conversation_language).toBe('ur');
      expect(last.questions).toHaveLength(1);
      expect(last.questions[0]).toMatchObject({ question_number: 1, question: QUESTION, answer: null });
    });

    test('WhatsApp mode is UNCHANGED — it still speaks the question', async () => {
      const Svc = arrange(freshRow());

      await Svc.conductReflectiveConversation('cs-1', '923001234567', 1);

      expect(generateSpeech).toHaveBeenCalledWith(
        expect.objectContaining({ text: QUESTION, site: 'question' }),
      );
      expect(sendAudio).toHaveBeenCalledTimes(1);
    });
  });

  describe('answering the question', () => {
    test('silent mode stores the answer, queues the report, and returns the acknowledgement', async () => {
      const Svc = arrange(answeringRow());

      const result = await Svc.handleReflectiveResponse(
        'cs-1', null, 'I wanted her to finish her thought.', 'text', 'ur', { silent: true },
      );

      expect(queueReport).toHaveBeenCalledTimes(1);          // report gating preserved
      expect(result).toMatchObject({ done: true, acknowledgement: ACK });
      expect(sendAudio).not.toHaveBeenCalled();
      expect(sendMessage).not.toHaveBeenCalled();
    });

    test('silent mode records the answer in the SAME shape as WhatsApp', async () => {
      const Svc = arrange(answeringRow());

      await Svc.handleReflectiveResponse('cs-1', null, 'Her thought mattered.', 'text', 'ur', { silent: true });

      const withAnswer = stateWrites.find((st) => st.questions && st.questions[0].answer);
      expect(withAnswer.questions[0]).toMatchObject({
        question_number: 1, answer: 'Her thought mattered.', format: 'text', language: 'ur',
      });
      expect(withAnswer.questions_answered).toBe(1);
    });

    test('WhatsApp mode is UNCHANGED — it still speaks the closing acknowledgement', async () => {
      const Svc = arrange(answeringRow());

      await Svc.handleReflectiveResponse('cs-1', '923001234567', 'Her thought mattered.', 'text', 'ur');

      expect(queueReport).toHaveBeenCalledTimes(1);
      expect(sendAudio).toHaveBeenCalledTimes(1);
    });
  });
});
