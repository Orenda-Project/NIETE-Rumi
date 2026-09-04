/**
 * The edit journey: KEEP → PICK → one screen per question → rebuild.
 *
 * Removing and editing are two different jobs, so they are two screens. On one
 * screen, unticking a question and then editing it are contradictory actions
 * taken in the same breath; ordered, the second list simply never offers a
 * question she has already dropped. That ordering is the thing most worth
 * pinning here, because it is invisible until someone does both.
 */

const mockRedis = { get: jest.fn(), set: jest.fn(), delete: jest.fn() };
const mockSupabase = { from: jest.fn() };
const mockRerender = jest.fn();
const mockListQuestions = jest.fn();
const mockSaveEdit = jest.fn();

jest.mock('../../bot/shared/services/cache/railway-redis.service', () => mockRedis);
jest.mock('../../bot/shared/config/supabase', () => mockSupabase);
jest.mock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn() }));
jest.mock('../../bot/shared/services/queue', () => ({ queueJob: jest.fn() }));
const mockEditFlag = jest.fn().mockResolvedValue(true);
jest.mock('../../bot/shared/config/feature-flags', () => ({
  isAssessmentGeneratorEnabled: jest.fn().mockResolvedValue(true),
  isAssessmentEditingEnabled: (...a) => mockEditFlag(...a),
  ASSESSMENT_GENERATOR_KEY: 'assessment_generator_enabled',
  ASSESSMENT_EDITING_KEY: 'assessment_editing_enabled',
}));
jest.mock('../../bot/shared/services/assessment/assessment-revision.service', () => ({
  rerender: (...a) => mockRerender(...a),
  listQuestions: (...a) => mockListQuestions(...a),
  saveEdit: (...a) => mockSaveEdit(...a),
}));

const Endpoint = require('../../bot/shared/routes/assessment-gen-endpoint');
const { handleAssessmentGenInit: init, handleAssessmentGenDataExchange: exchange } = Endpoint;

const TOKEN = 'user-1:assessment-review:paper-1';

const ITEMS = [
  { id: 'a.b.MCQs.0', number: 1, marks: 1, type: 'MCQs', text: 'Which is a living thing?',
    selected: true, shape: 'options',
    question: { question: 'Which is a living thing?', options: ['Rock', 'Plant'], marks: 1 } },
  { id: 'a.b.Fill.0', number: 2, marks: 1, type: 'Fill', text: 'Plants make food using ____.',
    selected: true, shape: 'standard',
    question: { question: 'Plants make food using ____.', marks: 1 } },
  { id: 'a.b.Match.0', number: 3, marks: 4, type: 'Match', text: 'Match the columns.',
    selected: true, shape: 'columns',
    question: { question: 'Match the columns.', column_a: ['Dog'], column_b: ['Kennel'], marks: 4 } },
];

beforeEach(() => {
  jest.clearAllMocks();
  mockRedis.get.mockResolvedValue(null);
  mockRedis.set.mockResolvedValue(true);
  mockListQuestions.mockResolvedValue({ items: ITEMS, paper: { id: 'paper-1' } });
  mockRerender.mockResolvedValue({ status: 'ready', questionCount: 3, marks: 6 });
  mockSaveEdit.mockResolvedValue({ status: 'ok' });
  mockEditFlag.mockResolvedValue(true);
});

const session = (over = {}) => mockRedis.get.mockResolvedValue({
  userId: 'user-1', paperId: 'paper-1', page: 0,
  selected: ITEMS.map((q) => q.id), ...over,
});

describe('KEEP — she decides what stays', () => {
  test('the review token opens on KEEP, not on the old single screen', async () => {
    const res = await init('user-1', TOKEN);
    expect(res.screen).toBe('KEEP');
    expect(res.data.questions).toHaveLength(3);
  });

  test('everything starts ticked — she is removing, not choosing from scratch', async () => {
    const res = await init('user-1', TOKEN);
    expect(res.data.selected).toEqual(ITEMS.map((q) => q.id));
  });

  test('continuing lands on PICK, not straight into a rebuild', async () => {
    session();
    const res = await exchange('user-1', 'KEEP',
      { keep: ITEMS.map((q) => q.id), page: '0', _action: 'done' }, TOKEN);
    expect(res.screen).toBe('PICK');
    expect(mockRerender).not.toHaveBeenCalled();
  });

  test('unticking everything is refused on the screen she can still fix it from', async () => {
    session({ selected: [] });
    const res = await exchange('user-1', 'KEEP', { keep: [], page: '0', _action: 'done' }, TOKEN);
    expect(res.screen).toBe('KEEP');
    expect(res.data.has_error).toBe(true);
  });
});

describe('PICK — the list only offers what survived KEEP', () => {
  test('a question she unticked is NOT offered for editing', async () => {
    // The reason the two screens are separate. On one screen these are
    // contradictory actions; ordered, the dropped question simply is not there.
    session({ selected: ['a.b.MCQs.0', 'a.b.Match.0'] });
    const res = await exchange('user-1', 'KEEP',
      { keep: ['a.b.MCQs.0', 'a.b.Match.0'], page: '0', _action: 'done' }, TOKEN);

    const titles = JSON.stringify(res.data.items);
    expect(titles).toContain('Which is a living thing?');
    expect(titles).not.toContain('Plants make food using');
  });

  test('the running total reflects what she dropped, before she rebuilds', async () => {
    session({ selected: ['a.b.MCQs.0', 'a.b.Match.0'] });
    await exchange('user-1', 'KEEP',
      { keep: ['a.b.MCQs.0', 'a.b.Match.0'], page: '0', _action: 'done' }, TOKEN);
    const res = await exchange('user-1', 'PICK', { _action: 'summary' }, TOKEN);
    expect(res.data.summary).toContain('2 questions');
    expect(res.data.summary).toContain('5 marks');
  });

  test('rebuilding from PICK_DONE sends only what is ticked', async () => {
    session({ selected: ['a.b.MCQs.0'] });
    const res = await exchange('user-1', 'PICK_DONE', { _action: 'rebuild' }, TOKEN);
    expect(res.screen).toBe('SUBMITTED');
    expect(mockRerender.mock.calls[0][0].selectedIds).toEqual(['a.b.MCQs.0']);
  });
});

describe('opening a question lands on the screen shaped for it', () => {
  test.each([
    ['a.b.MCQs.0', 'EDIT_OPTIONS'],
    ['a.b.Fill.0', 'EDIT_STANDARD'],
    ['a.b.Match.0', 'EDIT_COLUMNS'],
  ])('%s → %s', async (id, expected) => {
    session();
    const res = await exchange('user-1', 'PICK', { _action: 'open', question_id: id }, TOKEN);
    expect(res.screen).toBe(expected);
  });

  test('the options screen arrives pre-filled, with blanks to grow into', async () => {
    session();
    const res = await exchange('user-1', 'PICK',
      { _action: 'open', question_id: 'a.b.MCQs.0' }, TOKEN);
    expect(res.data.question).toBe('Which is a living thing?');
    expect(res.data.slot_0).toBe('Rock');
    expect(res.data.slot_1).toBe('Plant');
    expect(res.data.slot_2).toBe('');
    expect(res.data.marks).toBe(2 - 1);
  });

  test('the columns screen arrives as left/right pairs', async () => {
    session();
    const res = await exchange('user-1', 'PICK',
      { _action: 'open', question_id: 'a.b.Match.0' }, TOKEN);
    expect(res.data.left_0).toBe('Dog');
    expect(res.data.right_0).toBe('Kennel');
  });

  test('a question that is no longer there does not crash the Flow', async () => {
    session();
    const res = await exchange('user-1', 'PICK',
      { _action: 'open', question_id: 'gone.0' }, TOKEN);
    expect(res.data.has_error).toBe(true);
  });
});

describe('saving an edit', () => {
  test('writes at the question path and returns to the picker', async () => {
    session({ editing: 'a.b.MCQs.0' });
    const res = await exchange('user-1', 'EDIT_OPTIONS', {
      _action: 'save', question: 'Which of these is alive?',
      slot_0: 'Rock', slot_1: 'Plant', slot_2: 'Chair',
      slot_3: '', slot_4: '', slot_5: '', marks: '2',
    }, TOKEN);

    expect(res.screen).toBe('PICK_DONE');
    const [args] = mockSaveEdit.mock.calls[0];
    expect(args.questionId).toBe('a.b.MCQs.0');
    expect(args.edit.question).toBe('Which of these is alive?');
    expect(args.edit.slots).toEqual(['Rock', 'Plant', 'Chair', '', '', '']);
    expect(args.edit.marks).toBe('2');
  });

  test('a rejected edit comes back to the SAME screen with the reason', async () => {
    session({ editing: 'a.b.MCQs.0' });
    mockSaveEdit.mockResolvedValue({
      status: 'rejected', message: 'A multiple-choice question needs at least two options.' });
    const res = await exchange('user-1', 'EDIT_OPTIONS', {
      _action: 'save', question: 'q', slot_0: 'Rock',
      slot_1: '', slot_2: '', slot_3: '', slot_4: '', slot_5: '', marks: '1',
    }, TOKEN);

    expect(res.screen).toBe('EDIT_OPTIONS');
    expect(res.data.has_error).toBe(true);
    expect(res.data.error).toMatch(/at least two/i);
    // Her typing must survive the refusal, or she retypes the whole question.
    expect(res.data.slot_0).toBe('Rock');
  });

  test('editing a question then unticking it keeps BOTH', async () => {
    // The edit is stored at its path, the tick is stored separately — so
    // re-ticking later brings back HER wording, not the model's.
    session({ editing: 'a.b.MCQs.0' });
    await exchange('user-1', 'EDIT_OPTIONS', {
      _action: 'save', question: 'Hers', slot_0: 'a', slot_1: 'b',
      slot_2: '', slot_3: '', slot_4: '', slot_5: '', marks: '1',
    }, TOKEN);
    expect(mockSaveEdit).toHaveBeenCalled();

    // She now unticks the very question she just edited. All three are on page
    // one, so `keep` decides all three and the edited one really is dropped.
    const res = await exchange('user-1', 'KEEP',
      { keep: ['a.b.Fill.0', 'a.b.Match.0'], page: '0', _action: 'done' }, TOKEN);
    expect(res.screen).toBe('PICK');

    // The rebuild carries the tick list. Her EDIT is not in it and does not need
    // to be — it was written into exam_json at its path, so re-ticking that
    // question in a later session brings back her wording, not the model's.
    session({ selected: ['a.b.Fill.0', 'a.b.Match.0'] });
    await exchange('user-1', 'PICK_DONE', { _action: 'rebuild' }, TOKEN);
    expect(mockRerender.mock.calls[0][0].selectedIds).toEqual(['a.b.Fill.0', 'a.b.Match.0']);
  });
});

describe('comprehension splits into its sub-questions', () => {
  const COMP_ITEMS = [{
    id: 'a.b.Comp.0', number: 1, marks: 5, type: 'Comprehension',
    text: 'Read the passage.', selected: true, shape: 'comprehension',
    question: { passage: 'Ali went to the market.',
      questions: [{ question: 'Who went?', marks: 2 }, { question: 'What did he buy?', marks: 3 }] },
  }];

  test('opening it lists the sub-questions rather than inlining them', async () => {
    mockListQuestions.mockResolvedValue({ items: COMP_ITEMS, paper: { id: 'paper-1' } });
    session({ selected: ['a.b.Comp.0'] });
    const res = await exchange('user-1', 'PICK',
      { _action: 'open', question_id: 'a.b.Comp.0' }, TOKEN);
    expect(res.screen).toBe('EDIT_COMPREHENSION');
    expect(JSON.stringify(res.data.subs)).toContain('Who went?');
    expect(JSON.stringify(res.data.subs)).toContain('What did he buy?');
  });

  test('a sub-question opens on its own screen, carrying its passage for context', async () => {
    mockListQuestions.mockResolvedValue({ items: COMP_ITEMS, paper: { id: 'paper-1' } });
    session({ selected: ['a.b.Comp.0'] });
    const res = await exchange('user-1', 'EDIT_COMPREHENSION',
      { _action: 'open_sub', question_id: 'a.b.Comp.0', sub_index: '1' }, TOKEN);
    expect(res.screen).toBe('EDIT_SUB');
    expect(res.data.question).toBe('What did he buy?');
    expect(res.data.passage_hint).toContain('Ali went to the market');
  });

  test('saving a sub-question addresses it by index, not by rewriting the parent', async () => {
    mockListQuestions.mockResolvedValue({ items: COMP_ITEMS, paper: { id: 'paper-1' } });
    session({ selected: ['a.b.Comp.0'], editing: 'a.b.Comp.0', editingSub: 1 });
    await exchange('user-1', 'EDIT_SUB', {
      _action: 'save', question: 'What fruit?', marks: '4',
      slot_0: '', slot_1: '', slot_2: '', slot_3: '', slot_4: '', slot_5: '',
    }, TOKEN);
    const [args] = mockSaveEdit.mock.calls[0];
    expect(args.questionId).toBe('a.b.Comp.0');
    expect(args.edit.subIndex).toBe(1);
    expect(args.edit.question).toBe('What fruit?');
  });
});

describe('editing individual questions is its own flag (bd-60025)', () => {
  // Two flags, not one. Ticking is the safe half — it only ever removes
  // questions the model wrote, and it cannot corrupt the tree. Editing rewrites
  // stored JSON in place, so it ships behind its own switch and can be turned
  // off without taking the whole review layer down with it.
  beforeEach(() => { mockEditFlag.mockResolvedValue(false); });

  test('flag OFF: KEEP goes straight to the rebuild, never offering the picker', async () => {
    session();
    const res = await exchange('user-1', 'KEEP',
      { keep: ITEMS.map((q) => q.id), page: '0', _action: 'done' }, TOKEN);
    expect(res.screen).toBe('SUBMITTED');
    expect(mockRerender).toHaveBeenCalled();
  });

  test('flag ON: KEEP hands her the picker', async () => {
    mockEditFlag.mockResolvedValue(true);
    session();
    const res = await exchange('user-1', 'KEEP',
      { keep: ITEMS.map((q) => q.id), page: '0', _action: 'done' }, TOKEN);
    expect(res.screen).toBe('PICK');
    expect(mockRerender).not.toHaveBeenCalled();
  });

  test('flag OFF: an edit screen cannot be reached even if a client asks for one', async () => {
    // The flag is a gate, not a UI hint. A stale or hand-built client must not
    // be able to walk into a screen the deployment has switched off.
    session();
    const res = await exchange('user-1', 'PICK',
      { _action: 'open', question_id: 'a.b.MCQs.0' }, TOKEN);
    expect(res.screen).not.toMatch(/^EDIT_/);
  });

  test('flag OFF: a save posted directly is refused, not applied', async () => {
    session({ editing: 'a.b.MCQs.0' });
    const res = await exchange('user-1', 'EDIT_OPTIONS', {
      _action: 'save', question: 'sneaky', slot_0: 'a', slot_1: 'b',
      slot_2: '', slot_3: '', slot_4: '', slot_5: '', marks: '1',
    }, TOKEN);
    expect(mockSaveEdit).not.toHaveBeenCalled();
    expect(res.screen).not.toMatch(/^EDIT_/);
  });

  test('ticking still works with editing off — the safe half is unaffected', async () => {
    session({ selected: ITEMS.map((q) => q.id) });
    const res = await exchange('user-1', 'KEEP',
      { keep: ['a.b.MCQs.0'], page: '0', _action: 'done' }, TOKEN);
    expect(res.screen).toBe('SUBMITTED');
    expect(mockRerender.mock.calls[0][0].selectedIds).toEqual(['a.b.MCQs.0']);
  });
});
