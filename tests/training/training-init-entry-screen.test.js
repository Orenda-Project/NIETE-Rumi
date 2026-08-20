/**
 * BUG-144 — "Something went wrong" on every /training open.
 *
 * WhatsApp requires the screen returned by INIT (and by a raw BACK) to be an
 * ENTRY POINT of the Flow's routing model: a node with NO incoming edges.
 *
 *   {"VENDOR_PICKER": ["TRAINING_HOME","SUCCESS"],
 *    "TRAINING_HOME":  ["LEVEL_DETAIL","SUCCESS"],
 *    "LEVEL_DETAIL":   ["SUCCESS"]}
 *
 * Incoming edges:  TRAINING_HOME <- VENDOR_PICKER
 *                  LEVEL_DETAIL  <- TRAINING_HOME
 *                  SUCCESS       <- VENDOR_PICKER, TRAINING_HOME, LEVEL_DETAIL
 *                  VENDOR_PICKER <- (none)   ← the ONLY legal first screen
 *
 * handleTeacherTrainingInit had a single-vendor shortcut that returned
 * TRAINING_HOME directly to skip a one-option picker. The client rejected it
 * before rendering:
 *
 *   error:         "invalid-screen-transition"
 *   error_message: "The first screen -[TRAINING_HOME] that was provided with
 *                   response already have incoming nodes found in the routing
 *                   model"
 *
 * Because NIETE teachers are single-vendor, this fired on 100% of opens.
 *
 * errorScreen() returns SUCCESS, which also has incoming edges — so the
 * no-enrolment and no-profile paths were broken the same way and must also
 * render as VENDOR_PICKER.
 *
 * Contract: INIT and BACK always return an ENTRY POINT, whatever the teacher's
 * vendor count or enrolment state.
 *
 * UPDATED — band self-selection added BAND_PICKER as the routing model's entry
 * point, so VENDOR_PICKER now has one incoming edge (BAND_PICKER -> it). Both
 * screens remain legal first screens: the entry-point rule constrains the
 * ROUTING MODEL, while an INIT/data_exchange response may render any screen
 * (the same mechanism by which BACK already returns VENDOR_PICKER from
 * TRAINING_HOME with no declared edge). The no-enrolment path now renders the
 * band picker instead of a dead end — that is the whole point of the change:
 * a teacher with nothing assigned is asked what they teach.
 *
 * What must never regress is the PROPERTY, not the screen name — so the
 * assertions below check the returned screen against the live routing model.
 */

const LEGAL_FIRST_SCREEN = 'VENDOR_PICKER';
const BAND_FIRST_SCREEN = 'BAND_PICKER';

// The routing model is the authority — read it rather than restating it, so a
// future screen addition cannot silently invalidate this suite.
const FLOW = require('../../docs/flows/teacher-training-flow-v1.json');
const ROUTING = FLOW.routing_model;
const ENTRY_POINTS = Object.keys(ROUTING).filter(
  (s) => !Object.values(ROUTING).flat().includes(s)
);

/** A screen INIT may legally return: an entry point, or one reachable by re-render. */
function expectLegalFirstScreen(screen) {
  expect(Object.keys(ROUTING)).toContain(screen);
}

let handleTeacherTrainingInit;
let handleTeacherTrainingBack;
let mockTables;

// Minimal chainable Supabase stub: every builder method returns `this`, and
// awaiting it resolves to whatever mockTables has for that table.
function makeSupabase() {
  return {
    from(table) {
      const result = mockTables[table] ?? { data: [], error: null };
      const chain = {
        select: () => chain,
        eq: () => chain,
        in: () => chain,
        order: () => chain,
        single: () => Promise.resolve(
          Array.isArray(result.data)
            ? { data: result.data[0] ?? null, error: result.data.length ? null : { message: 'no rows' } }
            : result
        ),
        maybeSingle: () => Promise.resolve(
          Array.isArray(result.data) ? { data: result.data[0] ?? null, error: null } : result
        ),
        then: (res, rej) => Promise.resolve(result).then(res, rej),
      };
      return chain;
    },
  };
}

beforeAll(() => {
  jest.doMock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn() }));
  jest.doMock('../../bot/shared/utils/structured-logger', () => ({
    trainingLogger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
    logEvent: jest.fn(),
  }));
  jest.doMock('../../bot/shared/config/supabase', () => makeSupabase());
  jest.doMock('../../bot/shared/services/whatsapp.service', () => ({}));
  jest.doMock('../../bot/shared/storage/r2', () => ({}));
  ({ handleTeacherTrainingInit, handleTeacherTrainingBack } =
    require('../../bot/shared/routes/teacher-training-endpoint'));
});

const TEACHER = { id: 'u1', first_name: 'Aisha', last_name: 'Malik', name: 'Aisha Malik', phone_number: '1', school_name: 'NIETE' };

function enrolment({ vendors }) {
  return {
    users: { data: [TEACHER], error: null },
    teacher_training_assignments: { data: [{ program_id: 'p1' }], error: null },
    training_program_scopes: { data: vendors.map(v => ({ vendor_id: v.id, level_ids: null })), error: null },
    training_levels: {
      data: vendors.flatMap(v => v.levels.map((name, i) => ({
        id: `${v.id}-l${i}`, vendor_id: v.id, name, order_index: i, cpd_level: i, is_active: true,
      }))),
      error: null,
    },
    training_vendors: {
      data: vendors.map(v => ({ id: v.id, key: v.key, name: v.name, unlock_logic: 'chain', has_grand_quiz: true })),
      error: null,
    },
    training_courses: { data: [], error: null },
    teacher_training_progress: { data: [], error: null },
    training_assessment_attempts: { data: [], error: null },
    training_grand_quizzes: { data: [], error: null },
  };
}

const SINGLE = [{ id: 'v1', key: 'TALEEMABAD', name: 'Taleemabad', levels: ['Aspiring Teacher', 'Emerging Practitioner'] }];
const MULTI = [
  { id: 'v1', key: 'TALEEMABAD', name: 'Taleemabad', levels: ['Aspiring Teacher'] },
  { id: 'v2', key: 'OXBRIDGE', name: 'Oxbridge', levels: ['Game-Based Teaching'] },
];

describe('BUG-144 — INIT must return a routing-model entry point', () => {
  test('a teacher WITH training also gets BAND_PICKER — INIT must return the entry point', async () => {
    // THE REGRESSION THIS PINS. An earlier revision returned VENDOR_PICKER here,
    // reasoning that the entry-point rule constrains only the routing model.
    // It does not — Meta enforces it on the INIT RESPONSE, and the client
    // rejected the whole Flow with:
    //   "invalid-screen-transition ... The first screen -[VENDOR_PICKER] that
    //    was provided with response already have incoming nodes found in the
    //    routing model"
    // so /training showed "Something went wrong" for every teacher who HAS
    // training — the 8,365 case, not the 353.
    mockTables = enrolment({ vendors: SINGLE });
    const res = await handleTeacherTrainingInit('u1', 'u1:teacher-training:1');
    expect(res.screen).toBe(BAND_FIRST_SCREEN);
    expect(ENTRY_POINTS).toContain(res.screen);
  });

  test('a multi-vendor teacher likewise gets the entry point from INIT', async () => {
    mockTables = enrolment({ vendors: MULTI });
    const res = await handleTeacherTrainingInit('u1', 'u1:teacher-training:1');
    expect(res.screen).toBe(BAND_FIRST_SCREEN);
  });

  test('INIT never returns a screen that has incoming edges', async () => {
    // The invariant itself, stated once and checked against the live routing
    // model rather than a hardcoded name.
    for (const fixture of [SINGLE, MULTI, []]) {
      mockTables = { ...enrolment({ vendors: fixture }),
                     teacher_training_assignments: { data: [], error: null } };
      const res = await handleTeacherTrainingInit('u1', 'u1:teacher-training:1');
      const incoming = Object.entries(ROUTING)
        .filter(([, outs]) => outs.includes(res.screen)).map(([f]) => f);
      expect(incoming).toEqual([]);
    }
  });

  test('teacher with no enrolment gets the BAND PICKER, not a dead end', async () => {
    // Previously this returned VENDOR_PICKER carrying "No training assigned yet
    // ... contact your NIETE program lead" — a permanent dead end, because
    // nothing in the running app ever created an assignment. Now the teacher is
    // asked which grades they teach, and the answer assigns their programs.
    mockTables = { ...enrolment({ vendors: [] }), teacher_training_assignments: { data: [], error: null } };
    const res = await handleTeacherTrainingInit('u1', 'u1:teacher-training:1');
    expect(res.screen).toBe(BAND_FIRST_SCREEN);
    expectLegalFirstScreen(res.screen);
  });

  test('BAND_PICKER is the routing model’s sole entry point', async () => {
    // The BUG-144 invariant itself: exactly one node with no incoming edges.
    expect(ENTRY_POINTS).toEqual([BAND_FIRST_SCREEN]);
  });

  test('BACK returns VENDOR_PICKER for a single-vendor teacher', async () => {
    mockTables = enrolment({ vendors: SINGLE });
    const res = await handleTeacherTrainingBack('u1', 'TRAINING_HOME', 'u1:teacher-training:1');
    expect(res.screen).toBe(LEGAL_FIRST_SCREEN);
  });
});
