'use strict';
/**
 * bd-ra8xu.60 — the Observation Notes Flow's reply, and the informed DC scoring it starts.
 *
 * handleFlowReply claims every obsnotes:<session> token; it saves the notes (one per line) on the visit only when the
 * sender is that visit's coach, tells her how many were saved, and starts the informed scoring. runInformed scores the
 * visit with its notes once both the notes and the blind analysis exist, stores it under analysis_data.dc_informed,
 * never twice for the same notes, at most MAX_INFORMED_RUNS times; a failure is logged and nothing is stored.
 * Supabase, WhatsApp and the LLM (GPT5MiniService.analyzePedagogy) are mocked at the boundary.
 */

jest.mock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn(), logEvent: jest.fn() }));
jest.mock('../../bot/shared/services/whatsapp.service', () => ({
  sendMessage: jest.fn(() => Promise.resolve(true)),
  sendFlow: jest.fn(() => Promise.resolve(true)),
}));
jest.mock('../../bot/shared/services/gpt5-mini.service', () => ({ analyzePedagogy: jest.fn() }));
let mockLang = 'en';
jest.mock('../../bot/shared/services/observe/observe-language', () => ({ languageFor: jest.fn(async () => mockLang) }));

const mockDb = { settings: [], row: null, writes: [] };
jest.mock('../../bot/shared/config/supabase', () => {
  const make = (table) => {
    const q = { filters: [], patch: null };
    const b = {
      select: jest.fn(() => b),
      eq: jest.fn((k, v) => { q.filters.push([k, v]); return b; }),
      in: jest.fn(() => b),
      is: jest.fn(() => b),
      not: jest.fn(() => b),
      update: jest.fn((patch) => { q.patch = patch; return b; }),
      maybeSingle: jest.fn(() => {
        if (table === 'users') return Promise.resolve({ data: { region: 'Sihala' }, error: null });
        const idf = q.filters.find(([k]) => k === 'id');
        const row = mockDb.row && (!idf || idf[1] === mockDb.row.id) ? JSON.parse(JSON.stringify(mockDb.row)) : null;
        return Promise.resolve({ data: row, error: null });
      }),
      then: (resolve) => {
        if (table === 'app_settings') return resolve({ data: mockDb.settings, error: null });
        if (q.patch && table === 'coaching_sessions') {
          const guard = q.filters.find(([k]) => k === 'updated_at');
          if (guard && guard[1] !== mockDb.row.updated_at) return resolve({ data: [], error: null });
          mockDb.writes.push(q.patch);
          mockDb.row = { ...mockDb.row, ...q.patch, updated_at: `t${mockDb.writes.length}` };
          return resolve({ data: [{ id: mockDb.row.id }], error: null });
        }
        return resolve({ data: [], error: null });
      },
    };
    return b;
  };
  return { from: jest.fn((t) => make(t)) };
});

require('../../bot/shared/services/coaching/frameworks/fico17-v6/late-write').timing.sleep = () => Promise.resolve();

const WhatsAppService = require('../../bot/shared/services/whatsapp.service');
const GPT5 = require('../../bot/shared/services/gpt5-mini.service');
const { logToFile } = require('../../bot/shared/utils/logger');
const v6 = require('../../bot/shared/services/coaching/frameworks/fico17-v6');
const NotesSwitch = require('../../bot/shared/services/observe/observation-notes-switch');
const Notes = require('../../bot/shared/services/observe/observation-notes');
const informed = require('../../bot/shared/services/coaching/frameworks/fico17-v6/informed');

const COACH = 'aaaaaaaa-0000-4000-8000-0000000000c1';
const TRANSCRIPT = [
  '[00:10] Teacher (EN): Good morning children.',
  '[06:12] Teacher (EN): Is this right? Tell me.',
  '[06:20] Student (EN): Yes miss.',
  '[12:40] Teacher (EN): Now each of you come to the board.',
  '[20:00] Teacher (EN): Well done.',
].join('\n');

function blind() {
  const levels = {};
  for (const c of v6.DC_CODES) levels[c] = { result: 2, because: 'x', evidence: [] };
  return { framework: 'fico17_v6', rubric: 'fico17_v6', prompt_version: v6.DC_PROMPT_VERSION, levels };
}

function informedReply() {
  const levels = {};
  for (const c of v6.DC_CODES) levels[c] = { result: 2, because: 'closed questions', evidence: [{ time: '06:12', quote: 'Is this right? Tell me.' }] };
  levels.C1 = { result: 3, because: 'the note', evidence: [{ source: 'note', note_id: 'n1', quote: 'asked each one how they got it' }] };
  const combined = {};
  for (const c of ['C3', 'C5', 'C7', 'D3', 'D4']) combined[c] = { result: null, items: [] };
  return { analysis: { levels, combined_evidence: combined, notes: [{ note_id: 'n1', codes: ['C1'], label: 'not_in_recording' }] }, usage: { cost: 0.02 } };
}

const flush = async () => { for (let i = 0; i < 30; i++) await new Promise((r) => setImmediate(r)); };

beforeEach(() => {
  jest.clearAllMocks();
  NotesSwitch._resetCache();
  mockLang = 'en';
  mockDb.settings = [{ key: 'observation_notes', value: JSON.stringify({ [`user:${COACH}`]: 'on' }) }];
  mockDb.writes = [];
  mockDb.row = {
    id: 'sess-1', user_id: 'teacher-1', observer_user_id: COACH, observation_type: 'leader_observation',
    status: 'transcription_complete', framework: 'fico17_v6', transcript_text: TRANSCRIPT, audio_duration_seconds: 1200,
    updated_at: 't0', analysis_data: {}, autofill_analysis_data: null,
  };
  GPT5.analyzePedagogy.mockReset();
  GPT5.analyzePedagogy.mockResolvedValue(informedReply());
});

describe('the notes Flow reply', () => {
  test('the coach\'s notes are saved, one per line, and she is told how many', async () => {
    const handled = await Notes.handleFlowReply({ id: COACH }, '9230', 'obsnotes:sess-1',
      { flow_token: 'obsnotes:sess-1', notes: 'Board work: she asked each one how they got it\nBack rows silent' }, { messageId: 'wamid.1' });
    expect(handled).toBe(true);
    const stored = mockDb.row.analysis_data.observation_notes;
    expect(stored.map((n) => [n.id, n.text, n.source, n.typed_before_review, n.batch])).toEqual([
      ['n1', 'Board work: she asked each one how they got it', 'whatsapp', true, 'wa:wamid.1'],
      ['n2', 'Back rows silent', 'whatsapp', true, 'wa:wamid.1'],
    ]);
    expect(WhatsAppService.sendMessage).toHaveBeenCalledWith('9230', "📝 Saved 2 notes with this observation. You'll see them at the top of each section of Rumi's form.");
  });

  test('in Urdu, with Urdu digits; after the form was opened, the shorter line', async () => {
    mockLang = 'ur';
    mockDb.row.analysis_data = { observation_notes_review_opened_at: '2026-11-20T10:56:00.000Z' };
    await Notes.handleFlowReply({ id: COACH }, '9230', 'obsnotes:sess-1', { notes: 'ایک' }, { messageId: 'wamid.2' });
    expect(mockDb.row.analysis_data.observation_notes[0].typed_before_review).toBe(false);
    expect(WhatsAppService.sendMessage).toHaveBeenCalledWith('9230', '📝 آپ کے نوٹس اس مشاہدے کے ساتھ محفوظ ہو گئے (۱ نوٹ)۔');
  });

  test('the same reply delivered twice saves once', async () => {
    const r = { notes: 'a' };
    await Notes.handleFlowReply({ id: COACH }, '9230', 'obsnotes:sess-1', r, { messageId: 'wamid.3' });
    await Notes.handleFlowReply({ id: COACH }, '9230', 'obsnotes:sess-1', r, { messageId: 'wamid.3' });
    expect(mockDb.row.analysis_data.observation_notes).toHaveLength(1);
  });

  test('someone else\'s visit: claimed, nothing saved, nothing sent', async () => {
    const handled = await Notes.handleFlowReply({ id: 'someone-else' }, '9231', 'obsnotes:sess-1', { notes: 'x' }, { messageId: 'w' });
    expect(handled).toBe(true);
    expect(mockDb.writes).toHaveLength(0);
    expect(WhatsAppService.sendMessage).not.toHaveBeenCalled();
  });

  test('an observation that is over: nothing saved, she is told', async () => {
    mockDb.row.status = 'cancelled';
    await Notes.handleFlowReply({ id: COACH }, '9230', 'obsnotes:sess-1', { notes: 'x' }, { messageId: 'w' });
    expect(mockDb.writes).toHaveLength(0);
    expect(WhatsAppService.sendMessage).toHaveBeenCalledWith('9230', expect.stringMatching(/cancelled/i));
  });

  test('saved notes on a visit whose blind analysis is ready start the informed scoring', async () => {
    mockDb.row.autofill_analysis_data = blind();
    await Notes.handleFlowReply({ id: COACH }, '9230', 'obsnotes:sess-1', { notes: 'Board work: she asked each one how they got it' }, { messageId: 'w9' });
    await flush();
    expect(GPT5.analyzePedagogy).toHaveBeenCalledTimes(1);
    expect(mockDb.row.analysis_data.dc_informed).toMatchObject({ status: 'ok', note_ids: ['n1'], runs: 1 });
  });
});

describe('runInformed', () => {
  const withNotes = (texts) => texts.map((t, i) => ({ id: `n${i + 1}`, text: t, typed_before_review: true }));

  test('notes + blind analysis: one informed call, stored with its version, beside everything else', async () => {
    mockDb.row.autofill_analysis_data = blind();
    mockDb.row.analysis_data = { framework: 'fico17_v6', observation_notes: withNotes(['Board work: she asked each one how they got it']) };
    const out = await Notes.runInformed('sess-1');
    expect(out).toEqual({ ran: true, status: 'ok' });
    const [, meta, , fw] = GPT5.analyzePedagogy.mock.calls[0];
    expect(fw.promptVersion).toBe(informed.NOTES_PROMPT_VERSION);
    expect(meta).toMatchObject({ coachingSessionId: 'sess-1', duration: 1200 });
    const d = mockDb.row.analysis_data.dc_informed;
    expect(d).toMatchObject({ status: 'ok', prompt_version: informed.NOTES_PROMPT_VERSION, blind_prompt_version: v6.DC_PROMPT_VERSION, runs: 1 });
    expect(d.levels.C1.result).toBe(3);
    expect(mockDb.row.analysis_data.framework).toBe('fico17_v6');
    // Stored only: the blind analysis and the review's pre-fill source are untouched.
    expect(mockDb.row.autofill_analysis_data).toEqual(blind());
    expect(mockDb.row.analysis_data.levels).toBeUndefined();
  });

  test('the same notes again: no second call', async () => {
    mockDb.row.autofill_analysis_data = blind();
    mockDb.row.analysis_data = { observation_notes: withNotes(['a note']) };
    await Notes.runInformed('sess-1');
    const again = await Notes.runInformed('sess-1');
    expect(again).toEqual({ ran: false, why: 'up_to_date' });
    expect(GPT5.analyzePedagogy).toHaveBeenCalledTimes(1);
  });

  test('a later note is read by a new run; never more than MAX_INFORMED_RUNS', async () => {
    mockDb.row.autofill_analysis_data = blind();
    mockDb.row.analysis_data = { observation_notes: withNotes(['one']) };
    await Notes.runInformed('sess-1');
    mockDb.row.analysis_data.observation_notes = withNotes(['one', 'two']);
    await Notes.runInformed('sess-1');
    expect(mockDb.row.analysis_data.dc_informed).toMatchObject({ note_ids: ['n1', 'n2'], runs: 2 });
    mockDb.row.analysis_data.observation_notes = withNotes(['one', 'two', 'three']);
    await Notes.runInformed('sess-1');
    mockDb.row.analysis_data.observation_notes = withNotes(['one', 'two', 'three', 'four']);
    expect(await Notes.runInformed('sess-1')).toEqual({ ran: false, why: 'max_runs' });
    expect(GPT5.analyzePedagogy).toHaveBeenCalledTimes(Notes.MAX_INFORMED_RUNS);
  });

  test('nothing runs without notes, without the blind analysis, on a non-v6 visit, or with the switch off', async () => {
    mockDb.row.autofill_analysis_data = blind();
    mockDb.row.analysis_data = {};
    expect(await Notes.runInformed('sess-1')).toEqual({ ran: false, why: 'no_notes' });
    mockDb.row.analysis_data = { observation_notes: withNotes(['a']) };
    mockDb.row.autofill_analysis_data = null;
    expect(await Notes.runInformed('sess-1')).toEqual({ ran: false, why: 'no_blind' });
    mockDb.row.autofill_analysis_data = blind();
    mockDb.row.framework = 'fico';
    expect(await Notes.runInformed('sess-1')).toEqual({ ran: false, why: 'not_v6' });
    mockDb.row.framework = 'fico17_v6';
    mockDb.settings = [];
    NotesSwitch._resetCache();
    expect(await Notes.runInformed('sess-1')).toEqual({ ran: false, why: 'off' });
    expect(GPT5.analyzePedagogy).not.toHaveBeenCalled();
  });

  test('the model failing twice: logged with its correlation id, nothing stored, never throws', async () => {
    GPT5.analyzePedagogy.mockRejectedValue(new Error('provider down'));
    mockDb.row.autofill_analysis_data = blind();
    mockDb.row.analysis_data = { observation_notes: withNotes(['a']) };
    await expect(Notes.runInformed('sess-1')).resolves.toEqual({ ran: false, why: 'error' });
    expect(mockDb.row.analysis_data.dc_informed).toBeUndefined();
    const failed = logToFile.mock.calls.find(([m]) => /informed DC scoring failed/.test(m));
    expect(failed[1]).toMatchObject({ sessionId: 'sess-1', correlationId: 'dc-informed-sess-1', error: 'provider down' });
  });
});
