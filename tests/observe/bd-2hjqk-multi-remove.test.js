'use strict';
/**
 * REMOVING SEVERAL TEACHERS FROM ONE SCHOOL IN ONE PASS.
 *
 * Reported from the field: "To remove multiple teachers from the same school,
 * we have to repeat the entire process for each teacher. After removing one
 * teacher, we need to return to the main menu, select the school again, and
 * choose the Remove Teacher option."
 *
 * She is describing a real shape in the code, not a slow phone. TEACHER_PICK
 * was a Dropdown, which returns exactly one id, so one lap of the four screens
 * removed exactly one person — and the loop option on the terminal screen
 * reopens at MENU by design (reopening mid-flow hits the declared-key trap
 * that once made removing a school look like a no-op), so the school had to be
 * chosen again every time.
 *
 * The fix is the picker, not the loop: a tick-list, one confirm, one write.
 *
 * Two things this must NOT quietly become, both asserted below:
 *
 *   · a way around authorisation. A batch must not remove anyone a single
 *     removal would have refused, so the school is checked once and every id
 *     is then checked against THAT school's roll — not against the picker,
 *     which is a screen and cannot be trusted by a service.
 *   · N times the database work. Thirty teachers through the single-teacher
 *     path is ~120 round trips inside a data_exchange that Meta times out at
 *     ~10s. The writes are set-based: one read, one visit cancel, one school
 *     clear, one audit insert, whatever N is.
 */

const path = require('path');
const fs = require('fs');

const T = require('../../bot/shared/services/observe/observe-teacher-admin.service');

const FLOW = JSON.parse(fs.readFileSync(
  path.join(__dirname, '../../docs/flows/observe-visit-v2.json'), 'utf8'));

const screen = (id) => FLOW.screens.find((s) => s.id === id);

/** Every component of a type, anywhere in a screen's layout. */
function componentsOfType(node, type, acc = []) {
  if (Array.isArray(node)) { node.forEach((n) => componentsOfType(n, type, acc)); return acc; }
  if (node && typeof node === 'object') {
    if (node.type === type) acc.push(node);
    Object.values(node).forEach((v) => componentsOfType(v, type, acc));
  }
  return acc;
}

// ── the picker ─────────────────────────────────────────────────────────

describe('TEACHER_PICK takes more than one name', () => {
  const pick = () => screen('TEACHER_PICK');

  it('offers tick boxes, not a one-of dropdown', () => {
    const boxes = componentsOfType(pick().layout, 'CheckboxGroup');
    expect(boxes).toHaveLength(1);
    expect(componentsOfType(pick().layout, 'Dropdown')).toHaveLength(0);
    expect(boxes[0]['data-source']).toBe('${data.options}');
  });

  it('caps the selection at 30, and requires at least one', () => {
    const box = componentsOfType(pick().layout, 'CheckboxGroup')[0];
    expect(box['min-selected-items']).toBe(1);
    expect(box['max-selected-items']).toBe(30);
    expect(box.required).toBe(true);
  });

  it('sends the whole selection to the confirm step', () => {
    const footer = componentsOfType(pick().layout, 'Footer')[0];
    expect(footer['on-click-action'].payload).toMatchObject({
      step: 'teacher_remove_check',
      school_ext_id: '${data.school_ext_id}',
      teacher_ext_ids: '${form.picks}',
    });
  });
});

/**
 * The cap is THIS screen's, and the coach who asked for it asked exactly that.
 *
 * `max-selected-items` is a per-component attribute, so a number set here
 * cannot reach another flow — but a later edit that "tidies" these into a
 * shared constant would, silently, and every one of these is a different
 * feature with a different reason for its number. Pinning them is how that
 * edit fails here instead of in someone's registration.
 */
describe('the 30 does not leak into any other multi-select', () => {
  const CAPS = {
    'registration-flow-v3.json': [12, 11],
    'homework-request-flow.json': [12],
    'assessment-gen-flow.json': [6],
    'exam-checker-confirm-students-flow.json': [100],
  };

  it.each(Object.entries(CAPS))('%s keeps its own caps', (file, expected) => {
    const flow = JSON.parse(fs.readFileSync(
      path.join(__dirname, '../../docs/flows', file), 'utf8'));
    const found = [];
    for (const s of flow.screens || []) {
      for (const box of componentsOfType(s.layout, 'CheckboxGroup')) {
        if (typeof box['max-selected-items'] === 'number') found.push(box['max-selected-items']);
      }
    }
    expect(found).toEqual(expected);
  });

  it('only the remove picker carries 30', () => {
    const dir = path.join(__dirname, '../../docs/flows');
    const carriers = [];
    for (const file of fs.readdirSync(dir).filter((f) => f.endsWith('.json'))) {
      const flow = JSON.parse(fs.readFileSync(path.join(dir, file), 'utf8'));
      for (const s of flow.screens || []) {
        for (const box of componentsOfType(s.layout, 'CheckboxGroup')) {
          if (box['max-selected-items'] === 30) carriers.push(`${file}:${s.id}`);
        }
      }
    }
    expect(carriers).toEqual(['observe-visit-v2.json:TEACHER_PICK']);
  });
});

// ── the write ──────────────────────────────────────────────────────────

const SCHOOL = {
  school_ext_id: 'niete:916', school_id: 's916',
  school_name: 'IMCG, G-10/2', emis: '916',
};

const AT_SCHOOL = [
  { id: 'u1', phone_number: '923001234567', name: 'Tahira Manzoor', role: 'teacher', school_id: 's916' },
  { id: 'u2', phone_number: '923331112233', name: 'Nasreen Akhtar', role: 'teacher', school_id: 's916' },
  { id: 'u3', phone_number: '923214445566', name: null, role: 'teacher', school_id: 's916' },
];
const ELSEWHERE = { id: 'u9', phone_number: '923009999999', name: 'Someone Else', role: 'teacher', school_id: 's273' };

/** The db port, counted. Every method the batch is allowed to call is here. */
function fakeDb(over = {}) {
  const calls = { myschool: 0, usersByIds: 0, cancelUpcomingMany: 0, clearSchoolForUsers: 0, writeAudit: 0 };
  const db = {
    calls,
    audited: [],
    cleared: null,
    cancelledFor: null,
    async myschool(leaderUserId, schoolExtId) {
      calls.myschool += 1;
      return schoolExtId === SCHOOL.school_ext_id ? { ...SCHOOL } : null;
    },
    async usersByIds(ids) {
      calls.usersByIds += 1;
      return [...AT_SCHOOL, ELSEWHERE].filter((u) => ids.includes(u.id));
    },
    async cancelUpcomingMany({ teacherExtIds }) {
      calls.cancelUpcomingMany += 1;
      db.cancelledFor = teacherExtIds;
      return teacherExtIds.length;
    },
    async clearSchoolForUsers(ids) {
      calls.clearSchoolForUsers += 1;
      db.cleared = ids;
      return true;
    },
    async writeAudit(rows) {
      calls.writeAudit += 1;
      db.audited.push(...rows);
      return rows.length;
    },
    ...over,
  };
  return db;
}

const removeAll = (userIds, db, over = {}) => T.commitRemovals(
  { actorLeaderUserId: 'coach-a', schoolExtId: SCHOOL.school_ext_id, userIds, reason: 'transferred', ...over },
  { db },
);

describe('commitRemovals', () => {
  it('takes three people off in ONE set of writes', async () => {
    const db = fakeDb();
    const res = await removeAll(['u1', 'u2', 'u3'], db);

    expect(res.ok).toBe(true);
    expect(db.cleared).toEqual(['u1', 'u2', 'u3']);
    // Set-based: the count of writes does not grow with the count of teachers.
    expect(db.calls.clearSchoolForUsers).toBe(1);
    expect(db.calls.cancelUpcomingMany).toBe(1);
    expect(db.calls.writeAudit).toBe(1);
  });

  it('still records one audit row per teacher, with her own phone and name', async () => {
    const db = fakeDb();
    await removeAll(['u1', 'u2', 'u3'], db);

    expect(db.audited).toHaveLength(3);
    for (const row of db.audited) {
      expect(row.action).toBe('remove');
      expect(row.actor_user_id).toBe('coach-a');
      expect(row.from_school_ext_id).toBe(SCHOOL.school_ext_id);
      expect(row.to_school_ext_id).toBeNull();
      expect(row.detail.reason).toBe('transferred');
    }
    expect(db.audited.map((r) => r.teacher_phone_e164))
      .toEqual(['923001234567', '923331112233', '923214445566']);
    expect(db.audited.map((r) => r.teacher_name))
      .toEqual(['Tahira Manzoor', 'Nasreen Akhtar', null]);
  });

  it('cancels the upcoming visits of everyone removed, in one call', async () => {
    const db = fakeDb();
    const res = await removeAll(['u1', 'u2'], db);
    expect(db.cancelledFor).toEqual(['923001234567', '923331112233']);
    expect(res.visitsCancelled).toBe(2);
  });

  it('refuses a school that is not hers, before any write', async () => {
    const db = fakeDb();
    const res = await T.commitRemovals(
      { actorLeaderUserId: 'coach-a', schoolExtId: 'niete:001', userIds: ['u1'] }, { db });

    expect(res).toMatchObject({ ok: false, reason: 'not_my_school' });
    expect(db.calls.clearSchoolForUsers).toBe(0);
    expect(db.calls.writeAudit).toBe(0);
  });

  /**
   * The picker is a screen. A service that trusts it has no authorisation at
   * all — a replayed payload naming anyone in the district would go through.
   */
  it('skips a person who is not at that school, and removes the rest', async () => {
    const db = fakeDb();
    const res = await removeAll(['u1', 'u9'], db);

    expect(db.cleared).toEqual(['u1']);
    expect(res.skipped).toEqual(['u9']);
    expect(res.removed.map((p) => p.userId)).toEqual(['u1']);
  });

  it('refuses when nobody in the list is at that school', async () => {
    const db = fakeDb();
    const res = await removeAll(['u9'], db);
    expect(res).toMatchObject({ ok: false, reason: 'not_found' });
    expect(db.calls.clearSchoolForUsers).toBe(0);
  });

  it('refuses an empty selection', async () => {
    const db = fakeDb();
    const res = await removeAll([], db);
    expect(res).toMatchObject({ ok: false, reason: 'not_found' });
    expect(db.calls.myschool).toBe(0);
  });

  it('de-duplicates a repeated id rather than auditing her twice', async () => {
    const db = fakeDb();
    await removeAll(['u1', 'u1', 'u2'], db);
    expect(db.cleared).toEqual(['u1', 'u2']);
    expect(db.audited).toHaveLength(2);
  });

  /**
   * The client cap is a screen attribute and a screen is not a guard: the same
   * payload can arrive from a replay, or from an older published asset.
   */
  it('caps at 30 server-side and says what it did not do', async () => {
    const many = Array.from({ length: 34 }, (_, i) => `u${i}`);
    const db = fakeDb({
      async usersByIds(ids) {
        return ids.map((id) => ({
          id, phone_number: `9230000${String(id).slice(1).padStart(4, '0')}`,
          name: `Teacher ${id}`, role: 'teacher', school_id: 's916',
        }));
      },
    });
    const res = await removeAll(many, db);

    expect(db.cleared).toHaveLength(30);
    expect(res.skipped).toEqual(many.slice(30));
    expect(T.REMOVE_BATCH_MAX).toBe(30);
  });

  it('reports the school it acted on, for the screen that has to name it', async () => {
    const res = await removeAll(['u1'], fakeDb());
    expect(res.schoolName).toBe('IMCG, G-10/2');
  });
});

// ── the copy ───────────────────────────────────────────────────────────

/**
 * The confirm screen currently reads "Removed Tahira Manzoor from IMCG, G-10/2"
 * ABOVE a button that says "Yes, remove them" — it reuses the done-ack, so it
 * announces in the past tense something that has not happened. The screen's own
 * __example__ in the Flow JSON is "Tahira Manzoor will come off IMCG, G-10/2.",
 * which is what it was designed to say.
 */
describe('the confirm screen asks, and the done screen tells', () => {
  const NAMES = ['Tahira Manzoor', 'Nasreen Akhtar', 'Farah Gul'];

  it.each(['en', 'ur'])('%s: the plan is not written in the past tense', (lang) => {
    const body = T.removalPlanAck(lang, { names: NAMES, schoolName: 'IMCG, G-10/2' });
    expect(body).not.toMatch(/^Removed/);
    expect(body).not.toMatch(/^\*?[^*]*کو .* سے ہٹا دیا/);
  });

  it('the plan names everyone who was ticked, and the school', () => {
    const body = T.removalPlanAck('en', { names: NAMES, schoolName: 'IMCG, G-10/2' });
    for (const n of NAMES) expect(body).toContain(n);
    expect(body).toContain('IMCG, G-10/2');
    expect(body).toContain('3');
  });

  it('one person still reads as one person, not "1 people"', () => {
    const body = T.removalPlanAck('en', { names: ['Tahira Manzoor'], schoolName: 'IMCG, G-10/2' });
    expect(body).toContain('Tahira Manzoor');
    expect(body).not.toMatch(/\b1 people\b/);
  });

  it.each(['en', 'ur'])('%s: the done screen names everyone removed', (lang) => {
    const body = T.removedTeachersAck(lang, { names: NAMES, schoolName: 'IMCG, G-10/2' });
    for (const n of NAMES) expect(body).toContain(n);
    expect(body).toContain('IMCG, G-10/2');
  });

  it('a partial batch says which ones did not come off', () => {
    const body = T.removedTeachersAck('en', {
      names: ['Tahira Manzoor'], schoolName: 'IMCG, G-10/2', skippedCount: 2,
    });
    expect(body).toContain('2');
    expect(body).toMatch(/could not|not removed|still on/i);
  });

  it('Urdu is a real translation, not the English string', () => {
    const en = T.removedTeachersAck('en', { names: NAMES, schoolName: 'IMCG, G-10/2' });
    const ur = T.removedTeachersAck('ur', { names: NAMES, schoolName: 'IMCG, G-10/2' });
    expect(ur).not.toBe(en);
    expect(ur).toMatch(/[؀-ۿ]/);
  });
});
