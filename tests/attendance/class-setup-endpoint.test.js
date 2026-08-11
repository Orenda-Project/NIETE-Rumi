/**
 * Class setup — the paste-a-roster endpoint.
 *
 * The previous version of this screen added ONE student per round-trip to Meta:
 * type a name, choose "Add this student & continue", submit, wait, repeat. With a
 * median class of 32 and a maximum of 225, that is why 113 registered teachers
 * produced zero completed class setups.
 *
 * This endpoint takes the whole roster as one pasted block and is the reason the
 * rebuild exists, so the parser is tested harder than anything else here.
 */

const mockSupabase = { from: jest.fn() };
jest.mock('../../bot/shared/config/supabase', () => mockSupabase);
jest.mock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn() }));

const endpoint = require('../../bot/shared/routes/attendance-setup-endpoint');

describe('parseRoster — one paste becomes a clean student list', () => {
  const { parseRoster } = endpoint;

  it('splits on newlines and trims', () => {
    expect(parseRoster('Ayesha Bibi\n  Ahmed Raza  \nFatima Noor'))
      .toEqual(['Ayesha Bibi', 'Ahmed Raza', 'Fatima Noor']);
  });

  it('strips the numbering teachers paste from a register', () => {
    expect(parseRoster('1. Ayesha\n2) Ahmed\n3 - Fatima\n04. Bilal'))
      .toEqual(['Ayesha', 'Ahmed', 'Fatima', 'Bilal']);
  });

  it('strips bullets and dashes', () => {
    expect(parseRoster('- Ayesha\n• Ahmed\n* Fatima')).toEqual(['Ayesha', 'Ahmed', 'Fatima']);
  });

  it('drops blank lines rather than creating nameless students', () => {
    expect(parseRoster('Ayesha\n\n\n   \nAhmed')).toEqual(['Ayesha', 'Ahmed']);
  });

  it('de-dupes within the paste, case-insensitively, keeping first spelling', () => {
    expect(parseRoster('Ayesha Bibi\nAhmed\nayesha bibi\nAHMED'))
      .toEqual(['Ayesha Bibi', 'Ahmed']);
  });

  it('handles Windows line endings — a pasted-from-Excel roster', () => {
    expect(parseRoster('Ayesha\r\nAhmed\r\n')).toEqual(['Ayesha', 'Ahmed']);
  });

  it('keeps Urdu names intact', () => {
    expect(parseRoster('عائشہ بی بی\nاحمد رضا')).toEqual(['عائشہ بی بی', 'احمد رضا']);
  });

  it('does not mistake a name that starts with a digit-like word for numbering', () => {
    expect(parseRoster('7up Khan')).toEqual(['7up Khan']);
  });

  it('returns an empty array for empty/whitespace input rather than throwing', () => {
    expect(parseRoster('')).toEqual([]);
    expect(parseRoster('   \n  ')).toEqual([]);
    expect(parseRoster(null)).toEqual([]);
    expect(parseRoster(undefined)).toEqual([]);
  });

  it('caps a runaway paste rather than writing thousands of rows', () => {
    const huge = Array.from({ length: 400 }, (_, i) => `Student ${i}`).join('\n');
    expect(parseRoster(huge).length).toBe(300);
  });
});

describe('handleSetupInit — the grade picker', () => {
  it('offers the grades this teacher recorded at registration, first', async () => {
    mockSupabase.from.mockReturnValue({
      select: () => ({ eq: () => ({ single: () => Promise.resolve({
        data: { grades_taught: ['grade_5', 'grade_3'] }, error: null }) }) }),
    });

    const res = await endpoint.handleSetupInit('u1');

    expect(res.screen).toBe('CLASS');
    const ids = res.data.grades.map((g) => g.id);
    expect(ids.slice(0, 2)).toEqual(['grade_3', 'grade_5']);   // their own, in curriculum order
    expect(ids.length).toBeGreaterThan(2);                      // the rest still reachable
    expect(res.data.grade_hint).toMatch(/Grade 3|Grade 5/);
  });

  it('falls back to every grade when the teacher recorded none', async () => {
    mockSupabase.from.mockReturnValue({
      select: () => ({ eq: () => ({ single: () => Promise.resolve({
        data: { grades_taught: [] }, error: null }) }) }),
    });

    const res = await endpoint.handleSetupInit('u1');

    expect(res.data.grades.length).toBe(12);      // the full GRADES_DROPDOWN
    expect(res.data.grade_hint).not.toMatch(/You told us/);
  });
});

describe('the ROSTER screen echoes the parse back before writing', () => {
  it('reports the count and refuses an empty roster', async () => {
    const res = await endpoint.handleSetupDataExchange('u1', 'ROSTER', { roster: '  \n ' });
    expect(res.screen).toBe('ROSTER');
    expect(JSON.stringify(res.data)).toMatch(/no names|couldn't find/i);
  });

  it('moves to REVIEW with the parsed count when names are present', async () => {
    const res = await endpoint.handleSetupDataExchange('u1', 'ROSTER', {
      roster: '1. Ayesha\n2. Ahmed\n3. Fatima',
    });
    expect(res.screen).toBe('REVIEW');
    expect(res.data.heading).toMatch(/3/);
  });
});

/**
 * Screen-contract guard.
 *
 * An endpoint that returns a screen the Flow JSON does not declare is a dead end
 * on a real handset — Meta has nowhere to navigate. This is the same class of
 * fault as the reverted port, where a state machine returned an action the
 * handler never sent: verified at one layer, broken at the seam.
 */
describe('every screen the endpoint returns is declared in the Flow JSON', () => {
  const flow = require('../../docs/flows/attendance-setup-flow.json');
  const declared = new Set(flow.screens.map((s) => s.id));

  it('CLASS, ROSTER and REVIEW all exist', () => {
    ['CLASS', 'ROSTER', 'REVIEW'].forEach((s) => expect(declared.has(s)).toBe(true));
  });

  it('the endpoint source never names an undeclared screen', () => {
    const src = require('fs').readFileSync(
      require('path').join(__dirname, '../../bot/shared/routes/attendance-setup-endpoint.js'),
      'utf8',
    );
    const returned = [...src.matchAll(/screen:\s*'([A-Z_]+)'/g)].map((m) => m[1]);
    const undeclared = [...new Set(returned)].filter((s) => !declared.has(s));
    expect(undeclared).toEqual([]);
  });
});
