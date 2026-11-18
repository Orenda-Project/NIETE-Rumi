'use strict';
/**
 * ADDING SOMEONE WHO IS ALREADY THIS SCHOOL'S PRINCIPAL SAYS SO.
 *
 * A coach types a number to add a teacher, and it belongs to the school's own principal. Nothing is written — she is
 * already there — but the answer read as a contradiction: the plan carried no current school for "already here", so
 * WhatsApp's found screen said "School: not set" and the portal said "Current school: No school", next to "already at
 * this school". On production, 18 Nov, the GB community schools Deosai and Hoto each have two principals who are also
 * on their coaches' lists, so a coach there meets this case.
 *
 * The plan now names the school she is at (this one), and a principal is told plainly: already the principal here,
 * nothing to add. A teacher already here keeps today's words.
 */

const T = require('../../bot/shared/services/observe/observe-teacher-admin.service');

const DEOSAI = {
  school_ext_id: 'niete:gb-deosai-community-school-dapa-kharmang', school_id: 's-deosai',
  school_name: 'Deosai Community school Dapa Kharmang', emis: null, region: 'Gilgit-Baltistan', is_probable_test: false,
};

const fakeDb = (user) => ({
  myschool: jest.fn(async () => DEOSAI),
  schoolOf: jest.fn(async () => null),
  userByPhone: jest.fn(async () => user),
});

const PRINCIPAL = { id: 'p1', phone_number: '923001234567', role: 'principal', school_id: 's-deosai', name: 'Arif Hussain' };
const TEACHER = { ...PRINCIPAL, id: 't1', role: 'teacher', name: 'Nadia Akbar' };
const ADD = { actorLeaderUserId: 'coach-gb', schoolExtId: DEOSAI.school_ext_id, rawPhone: '0300 1234567' };

describe('the plan for someone already at this school', () => {
  it('names the school they are at: this one', async () => {
    const plan = await T.planAdd(ADD, { db: fakeDb(PRINCIPAL) });
    expect(plan.outcome).toBe('already_here');
    expect(plan.fromSchoolName).toBe(DEOSAI.school_name);
    expect(plan.fromSchoolExtId).toBe(DEOSAI.school_ext_id);
  });
});

describe('WhatsApp: the answer after Add', () => {
  const plan = async (u) => T.planAdd(ADD, { db: fakeDb(u) });

  it('a principal: already the principal at this school, nothing to add', async () => {
    const en = T.addPlanAck('en', await plan(PRINCIPAL));
    expect(en).toBe('*Arif Hussain* is already the principal at *Deosai Community school Dapa Kharmang*. Nothing to add.');
    const ur = T.addPlanAck('ur', await plan(PRINCIPAL));
    expect(ur).toContain('*Arif Hussain*');
    expect(ur).toContain('*Deosai Community school Dapa Kharmang*');
    expect(ur).toContain('پرنسپل');
    expect(ur).not.toContain('موجود ہیں۔ کچھ تبدیل');   // not the plain "already here" sentence
  });

  it('a teacher already here keeps today\'s words', async () => {
    expect(T.addPlanAck('en', await plan(TEACHER)))
      .toBe('*Nadia Akbar* is already at *Deosai Community school Dapa Kharmang*. Nothing to change.');
  });
});

describe('WhatsApp: the confirm screen', () => {
  it('a principal: the school line names this school, and the sentence says principal', async () => {
    const p = await T.planAdd(ADD, { db: fakeDb(PRINCIPAL) });
    const en = T.foundAccountScreen('en', p, DEOSAI.school_ext_id);
    expect(en.found_details).toBe('Name: Arif Hussain (Principal)\nSchool: Deosai Community school Dapa Kharmang');
    expect(en.plan).toBe('They are already the principal at *Deosai Community school Dapa Kharmang*. Nothing to add.');
    const ur = T.foundAccountScreen('ur', p, DEOSAI.school_ext_id);
    expect(ur.found_details).toContain('Deosai Community school Dapa Kharmang');
    expect(ur.found_details).not.toContain('درج نہیں');
    expect(ur.plan).toContain('پرنسپل');
  });

  it('a teacher already here: the school line names this school; the sentence is unchanged', async () => {
    const p = await T.planAdd(ADD, { db: fakeDb(TEACHER) });
    const en = T.foundAccountScreen('en', p, DEOSAI.school_ext_id);
    expect(en.found_details).toBe('Name: Nadia Akbar\nSchool: Deosai Community school Dapa Kharmang');
    expect(en.plan).toBe('They are already at *Deosai Community school Dapa Kharmang*. Nothing to change.');
  });
});
