/**
 * bd-r2uzg1.14 — ICT plan #13 (HITL row 190): the send confirm names the
 * teacher AND her school before the coach taps Send now.
 *
 * bd-zpyf0 put "📨 To: {name} ({phone})" on the confirm. Two gaps remained:
 *
 * 1. A coach who visits several schools sees the same teacher names more than
 *    once, so the name alone does not tell her she picked the right Saima. The
 *    school of the account that owns the number is on file for 91% of report
 *    recipients (NIETE prod, last 45 days: 1,912 of 2,100 sends), so the
 *    confirm adds a "🏫 {school}" line when there is one, and nothing when
 *    there is not. The lookup is by the number the report goes TO — never the
 *    session's user_id, which is the coach on an unbound capture.
 *
 * 2. In the Urdu confirm the Latin name and "(+92…)" sat in an RTL line
 *    unisolated, so the paragraph reorders the run and the brackets land on
 *    the wrong side. Each placeholder is now isolated (FSI for the name and
 *    school, whose script is unknowable; LRI for the number), as the other
 *    observe strings already do.
 */
process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'http://localhost';
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'test-key';
process.env.OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY || 'test-key';
process.env.OPENAI_API_KEY = process.env.OPENAI_API_KEY || 'test-key';
process.env.OBSERVE_FRAMEWORK = 'fico';   // NIETE: offers ur/en, defaults en

jest.mock('../../shared/services/whatsapp.service', () => ({
  sendMessage: jest.fn().mockResolvedValue(true),
  sendInteractiveButtons: jest.fn().mockResolvedValue(true),
  sendImageFromBuffer: jest.fn().mockResolvedValue(true),
  sendTemplate: jest.fn().mockResolvedValue(true),
}));
jest.mock('../../shared/services/observe/observe-state.service', () => ({
  getState: jest.fn().mockResolvedValue(null),
  setState: jest.fn().mockResolvedValue(true),
  clearState: jest.fn().mockResolvedValue(true),
}));
jest.mock('../../shared/services/gpt5-mini.service', () => ({ completeJson: jest.fn() }));
jest.mock('../../shared/services/coaching/report-v2/hero-report.service', () => ({
  generateHeroReport: jest.fn().mockResolvedValue({ png: Buffer.from('png'), caption: 'cap' }),
}));
jest.mock('../../shared/storage/r2', () => ({
  uploadImageBuffer: jest.fn().mockResolvedValue('https://r2/x.png'),
  downloadFromR2: jest.fn().mockResolvedValue(Buffer.from('png')),
}));
jest.mock('../../shared/services/quiz/quiz-delivery.service', () => ({
  _hasOpenMessageWindow: jest.fn().mockResolvedValue(true),
}));

const COACH_ID = 'coach-1';
const TEACHER_ID = 'teacher-1';
const OTHER_ID = 'teacher-2';
const COACH_PHONE = '923200000001';
const TEACHER_PHONE = '923001112222';
const OTHER_PHONE = '923004445555';
const TEACHER_SCHOOL = 'IMSB (I-V) G-6/1-3 Islamabad';
const OTHER_SCHOOL = 'IMCG F-7/2';

// A users table keyed by id and by phone. Each lookup records which column it
// filtered on, so a test can prove WHOSE school was read, not just that one was.
const db = { session: null, users: [], lookups: [], failPhoneLookup: false };

jest.mock('../../shared/config/supabase', () => ({
  from: jest.fn((table) => {
    if (table === 'users') {
      const filters = [];
      const find = () => db.users.filter((u) => filters.every(([c, v]) => u[c] === v));
      const chain = {
        select: () => chain,
        eq: (c, v) => { filters.push([c, v]); return chain; },
        limit: async () => ({ data: find(), error: null }),
        maybeSingle: async () => {
          db.lookups.push(filters.map(([c, v]) => `${c}=${v}`).join('&'));
          if (db.failPhoneLookup && filters.some(([c]) => c === 'phone_number')) {
            throw new Error('network down');
          }
          const rows = find();
          if (rows.length > 1) return { data: null, error: { message: 'multiple rows' } };
          return { data: rows[0] || null, error: null };
        },
        single: async () => ({ data: null, error: { message: 'not found' } }),
      };
      return chain;
    }
    const chain = {
      select: () => chain,
      eq: () => chain,
      neq: () => chain,
      order: () => chain,
      limit: async () => ({ data: [], error: null }),
      single: async () => (db.session
        ? { data: db.session, error: null }
        : { data: null, error: { message: 'not found' } }),
      update: (patch) => {
        if (db.session) db.session = { ...db.session, ...patch };
        return { eq: async () => ({ error: null }) };
      },
    };
    return chain;
  }),
}));

const WhatsAppService = require('../../shared/services/whatsapp.service');
const GPT5MiniService = require('../../shared/services/gpt5-mini.service');
const ObserveSend = require('../../shared/services/observe/observe-send.service');
const { observeStrings } = require('../../shared/services/observe/observe-strings');

const SID = 'sess-r2uzg1-14';
const FSI = '⁨';
const LRI = '⁦';
const PDI = '⁩';

function people(coachLang) {
  return [
    { id: COACH_ID, name: 'Misbah Iqbal', phone_number: COACH_PHONE, preferred_language: coachLang, school_name: 'NIETE HQ' },
    { id: TEACHER_ID, name: 'Kamran Afzal', phone_number: TEACHER_PHONE, preferred_language: 'ur', school_name: TEACHER_SCHOOL },
    { id: OTHER_ID, name: 'Saima Bibi', phone_number: OTHER_PHONE, preferred_language: 'ur', school_name: OTHER_SCHOOL },
  ];
}

/** A BOUND observation: user_id is the teacher, observer_user_id is the coach. */
function boundSession(delivery = {}) {
  return {
    id: SID,
    user_id: TEACHER_ID,
    observer_user_id: COACH_ID,
    observation_type: 'leader_observation',
    status: 'observer_review_complete',
    debrief_status: 'done',
    analysis_data: {
      framework: 'fico',
      teacher_delivery: {
        teacher_name: 'Kamran Afzal', teacher_phone: TEACHER_PHONE, status: 'previewing', ...delivery,
      },
    },
  };
}

async function confirmBody() {
  await ObserveSend.processTeacherReport(SID, { phase: 'preview', from: COACH_PHONE });
  expect(WhatsAppService.sendInteractiveButtons).toHaveBeenCalledTimes(1);
  const [to, payload] = WhatsAppService.sendInteractiveButtons.mock.calls[0];
  expect(to).toBe(COACH_PHONE);
  return payload.body;
}

const cp = (s) => [...String(s)].length;
const PLACEHOLDER = /\{(name|phone|school|school_line)\}/;

beforeEach(() => {
  jest.clearAllMocks();
  db.session = null; db.users = []; db.lookups = []; db.failPhoneLookup = false;
  GPT5MiniService.completeJson.mockResolvedValue({ result: null });
});

describe('bd-r2uzg1.14 — the send confirm names the teacher\'s school', () => {
  it.each([
    ['en', '🏫 School:'],
    ['ur', '🏫 اسکول:'],
  ])('the %s confirm carries the recipient\'s school on its own line', async (coachLang, label) => {
    db.session = boundSession();
    db.users = people(coachLang);

    const body = await confirmBody();

    expect(body).toContain('Kamran Afzal');
    expect(body).toContain(`+${TEACHER_PHONE}`);
    expect(body).toContain(`${label} ${FSI}${TEACHER_SCHOOL}${PDI}`);
    // The recipient line, then the school line, then the question.
    const lines = body.split('\n');
    expect(lines[0]).toContain('Kamran Afzal');
    expect(lines[1]).toContain(TEACHER_SCHOOL);
    expect(body).not.toMatch(PLACEHOLDER);
    expect(cp(body)).toBeLessThanOrEqual(1024);
    // The school is that of the number the report goes to — read by phone.
    expect(db.lookups).toContain(`phone_number=${TEACHER_PHONE}`);
  });

  it('a report going to someone else names THAT person\'s school, not the bound teacher\'s', async () => {
    db.session = boundSession({ teacher_name: 'Saima Bibi', teacher_phone: OTHER_PHONE });
    db.users = people('en');

    const body = await confirmBody();

    expect(body).toContain('Saima Bibi');
    expect(body).toContain(OTHER_SCHOOL);
    expect(body).not.toContain(TEACHER_SCHOOL);
  });

  it('a recipient with no school on file gets no school line and no leftover placeholder', async () => {
    db.session = boundSession();
    db.users = people('en').map((u) => (u.id === TEACHER_ID ? { ...u, school_name: '   ' } : u));

    const body = await confirmBody();

    expect(body).toContain('Kamran Afzal');
    expect(body).not.toContain('🏫');
    expect(body).not.toMatch(PLACEHOLDER);
    // the question follows the recipient line exactly as before
    expect(body.split('\n')[1]).toBe('');
  });

  it('a typed number nobody has an account for gets no school line', async () => {
    db.session = boundSession({ teacher_name: 'Ms Sania', teacher_phone: '923019998888' });
    db.users = people('en');

    const body = await confirmBody();

    expect(body).toContain('Ms Sania');
    expect(body).not.toContain('🏫');
    expect(body).not.toMatch(PLACEHOLDER);
  });

  it('a failed school lookup never blocks the confirm', async () => {
    db.session = boundSession();
    db.users = people('en');
    db.failPhoneLookup = true;

    const body = await confirmBody();

    expect(body).toContain('Kamran Afzal');
    expect(body).not.toContain('🏫');
  });

  it('the Urdu confirm isolates the name, the number and the school inside its RTL line', () => {
    const S = observeStrings('ur');
    const { body } = ObserveSend.buildSendConfirmButtons(SID, S, {
      name: 'Kamran Afzal', phone: TEACHER_PHONE, school: TEACHER_SCHOOL,
    });
    expect(body).toContain(`${FSI}Kamran Afzal${PDI}`);
    expect(body).toContain(`(${LRI}+${TEACHER_PHONE}${PDI})`);
    expect(body).toContain(`${FSI}${TEACHER_SCHOOL}${PDI}`);
  });

  it.each(['en', 'ur', 'sw'])('a nameless %s recipient leaves no empty isolate or bracket pair', (lang) => {
    const S = observeStrings(lang);
    const { body } = ObserveSend.buildSendConfirmButtons(SID, S, { name: '', phone: TEACHER_PHONE });
    expect(body).toContain(`+${TEACHER_PHONE}`);
    expect(body).not.toContain(`${FSI}${PDI}`);
    expect(body).not.toMatch(/\(\s*\)/);
    expect(body).not.toMatch(/ {2,}/);
    expect(body).not.toMatch(PLACEHOLDER);
  });

  it.each(['en', 'ur', 'sw'])('the %s templates carry the school slot and its label', (lang) => {
    const S = observeStrings(lang);
    expect(S.send_confirm_body).toContain('{school_line}');
    expect(S.send_confirm_school).toContain('{school}');
    // the school line is a line of its own under the recipient
    expect(S.send_confirm_school.startsWith('\n')).toBe(true);
  });
});
