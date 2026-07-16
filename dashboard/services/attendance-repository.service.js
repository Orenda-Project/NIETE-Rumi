/**
 * Teacher Attendance Repository (NIETE STEPS-P: Teacher Presence)
 *
 * Interface for teacher-attendance persistence. Two implementations:
 *   * RealAttendanceRepository — Supabase-backed (production + staging)
 *   * MockAttendanceRepository — in-memory seed data for tests + demo
 *
 * Selection is driven by env: set ATTENDANCE_REPO=mock (or NODE_ENV=test) to
 * use the mock. Defaults to real.
 *
 * Interface (all methods return Promises):
 *   getTeachersBySchool(school_id)
 *       -> Array<{id, first_name, last_name, phone_number, role}>
 *   saveAttendance({teacher_id, school_id, date, status, leave_type, marked_by_user_id})
 *       -> {id, teacher_id, school_id, date, status, leave_type, marked_by_user_id, marked_at}
 *   getAttendanceForTeacher(teacher_id, start_date, end_date)
 *       -> Array<record>
 *   getAttendanceForSchool(school_id, start_date, end_date)
 *       -> Array<record>
 *   getPresence({teacher_id?, mobile?, school_id?, start_date?, end_date?})
 *       -> object (single teacher) OR Array<object> (school_id case) with:
 *          {teacher_id, mobile, school_id, period_start, period_end,
 *           present_days, absent_days, leave_days, working_days, presence_pct}
 *
 * The computePresence() helper is exported for direct use in tests + callers
 * who already have per-day rows in hand.
 */

// ───────────────────────────────────────────────────────────────────────────────
// Presence math
// ───────────────────────────────────────────────────────────────────────────────

/**
 * Compute a presence rollup from an array of attendance records.
 *
 * Per Hasnat's spec:
 *   * presence_pct = round(present_days / working_days * 100, 1dp)
 *   * working_days = distinct dates actually marked (no external calendar)
 *   * working_days === 0  →  presence_pct = 0 (division-by-zero guard)
 *
 * @param {Array<{date, status}>} records
 * @returns {{present_days, absent_days, leave_days, working_days, presence_pct}}
 */
function computePresence(records) {
  const seenDates = new Set();
  let present = 0;
  let absent = 0;
  let leave = 0;
  for (const r of records || []) {
    if (!r || !r.date) continue;
    seenDates.add(String(r.date));
    if (r.status === 'present') present += 1;
    else if (r.status === 'absent') absent += 1;
    else if (r.status === 'leave') leave += 1;
  }
  const working_days = seenDates.size;
  const presence_pct = working_days === 0
    ? 0
    : Math.round((present / working_days) * 1000) / 10; // 1dp
  return {
    present_days: present,
    absent_days: absent,
    leave_days: leave,
    working_days,
    presence_pct,
  };
}

/**
 * Validate a status + leave_type combination. Throws on invalid.
 */
function validateStatusAndLeaveType(status, leave_type) {
  const validStatuses = ['present', 'absent', 'leave'];
  const validLeaveTypes = ['casual', 'sick', 'official'];
  if (!validStatuses.includes(status)) {
    throw new Error(`Invalid status: ${status}. Must be one of ${validStatuses.join(', ')}.`);
  }
  if (status === 'leave') {
    if (!leave_type || !validLeaveTypes.includes(leave_type)) {
      throw new Error(`leave_type required when status='leave'. Must be one of ${validLeaveTypes.join(', ')}.`);
    }
  } else if (leave_type != null) {
    throw new Error(`leave_type must be null when status='${status}'.`);
  }
}

// ───────────────────────────────────────────────────────────────────────────────
// Real Supabase-backed implementation
// ───────────────────────────────────────────────────────────────────────────────

class RealAttendanceRepository {
  /**
   * @param {import('@supabase/supabase-js').SupabaseClient} supabase
   */
  constructor(supabase) {
    if (!supabase) throw new Error('RealAttendanceRepository requires a Supabase client.');
    this.supabase = supabase;
  }

  async getTeachersBySchool(school_id) {
    const { data, error } = await this.supabase
      .from('users')
      .select('id, first_name, last_name, phone_number, role, school_id')
      .eq('school_id', school_id)
      .eq('role', 'teacher');
    if (error) throw error;
    return data || [];
  }

  async saveAttendance({ teacher_id, school_id, date, status, leave_type, marked_by_user_id }) {
    validateStatusAndLeaveType(status, leave_type);
    if (!teacher_id || !school_id || !date || !marked_by_user_id) {
      throw new Error('saveAttendance requires teacher_id, school_id, date, marked_by_user_id.');
    }
    // Upsert on the unique (teacher_id, date) constraint — re-marking a teacher
    // for the same date overwrites the previous mark. updated_at bumps.
    const { data, error } = await this.supabase
      .from('teacher_attendance_records')
      .upsert({
        teacher_id,
        school_id,
        date,
        status,
        leave_type: leave_type || null,
        marked_by_user_id,
        marked_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      }, { onConflict: 'teacher_id,date' })
      .select()
      .single();
    if (error) throw error;
    return data;
  }

  async getAttendanceForTeacher(teacher_id, start_date, end_date) {
    let q = this.supabase
      .from('teacher_attendance_records')
      .select('*')
      .eq('teacher_id', teacher_id);
    if (start_date) q = q.gte('date', start_date);
    if (end_date) q = q.lte('date', end_date);
    const { data, error } = await q.order('date', { ascending: false });
    if (error) throw error;
    return data || [];
  }

  async getAttendanceForSchool(school_id, start_date, end_date) {
    let q = this.supabase
      .from('teacher_attendance_records')
      .select('*')
      .eq('school_id', school_id);
    if (start_date) q = q.gte('date', start_date);
    if (end_date) q = q.lte('date', end_date);
    const { data, error } = await q.order('date', { ascending: false });
    if (error) throw error;
    return data || [];
  }

  async _resolveTeacherByMobile(mobile) {
    const { data, error } = await this.supabase
      .from('users')
      .select('id, phone_number, school_id')
      .eq('phone_number', mobile)
      .maybeSingle();
    if (error) throw error;
    return data;
  }

  async getPresence({ teacher_id, mobile, school_id, start_date, end_date }) {
    // ONE of {teacher_id, mobile, school_id} is required.
    if (!teacher_id && !mobile && !school_id) {
      throw new Error('getPresence requires one of teacher_id, mobile, or school_id.');
    }

    // Compute the period window: default = all-time (nulls handled by SQL).
    const period_start = start_date || null;
    const period_end = end_date || null;

    if (school_id) {
      // School-wide: return one presence row per teacher in the school.
      const teachers = await this.getTeachersBySchool(school_id);
      const records = await this.getAttendanceForSchool(school_id, period_start, period_end);
      const byTeacher = new Map();
      for (const r of records) {
        if (!byTeacher.has(r.teacher_id)) byTeacher.set(r.teacher_id, []);
        byTeacher.get(r.teacher_id).push(r);
      }
      return teachers.map((t) => {
        const rec = computePresence(byTeacher.get(t.id) || []);
        return {
          teacher_id: t.id,
          mobile: t.phone_number,
          school_id,
          period_start,
          period_end,
          ...rec,
        };
      });
    }

    // Single-teacher path — resolve teacher_id (from mobile if needed).
    let tid = teacher_id;
    let mob = mobile;
    let sid = null;
    if (!tid && mobile) {
      const t = await this._resolveTeacherByMobile(mobile);
      if (!t) {
        return {
          teacher_id: null, mobile, school_id: null,
          period_start, period_end,
          present_days: 0, absent_days: 0, leave_days: 0,
          working_days: 0, presence_pct: 0,
        };
      }
      tid = t.id;
      sid = t.school_id;
    }
    if (tid && !mob) {
      const { data: u } = await this.supabase
        .from('users')
        .select('phone_number, school_id')
        .eq('id', tid)
        .maybeSingle();
      if (u) {
        mob = u.phone_number;
        sid = u.school_id;
      }
    }

    const records = await this.getAttendanceForTeacher(tid, period_start, period_end);
    const rec = computePresence(records);
    return {
      teacher_id: tid,
      mobile: mob || null,
      school_id: sid,
      period_start,
      period_end,
      ...rec,
    };
  }
}

// ───────────────────────────────────────────────────────────────────────────────
// Mock in-memory implementation (tests + demo)
// ───────────────────────────────────────────────────────────────────────────────

class MockAttendanceRepository {
  constructor(seed = {}) {
    this.teachers = seed.teachers || []; // {id, first_name, last_name, phone_number, role, school_id}
    this.records = seed.records || [];   // {id, teacher_id, school_id, date, status, leave_type, marked_by_user_id, marked_at}
    this._nextId = 1;
  }

  async getTeachersBySchool(school_id) {
    return this.teachers.filter((t) => t.school_id === school_id && t.role === 'teacher');
  }

  async saveAttendance({ teacher_id, school_id, date, status, leave_type, marked_by_user_id }) {
    validateStatusAndLeaveType(status, leave_type);
    if (!teacher_id || !school_id || !date || !marked_by_user_id) {
      throw new Error('saveAttendance requires teacher_id, school_id, date, marked_by_user_id.');
    }
    const idx = this.records.findIndex((r) => r.teacher_id === teacher_id && r.date === date);
    const row = {
      id: idx >= 0 ? this.records[idx].id : `mock-att-${this._nextId++}`,
      teacher_id,
      school_id,
      date,
      status,
      leave_type: leave_type || null,
      marked_by_user_id,
      marked_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
    if (idx >= 0) this.records[idx] = row;
    else this.records.push(row);
    return row;
  }

  async getAttendanceForTeacher(teacher_id, start_date, end_date) {
    return this.records
      .filter((r) => r.teacher_id === teacher_id
        && (!start_date || r.date >= start_date)
        && (!end_date || r.date <= end_date))
      .sort((a, b) => (a.date < b.date ? 1 : -1));
  }

  async getAttendanceForSchool(school_id, start_date, end_date) {
    return this.records
      .filter((r) => r.school_id === school_id
        && (!start_date || r.date >= start_date)
        && (!end_date || r.date <= end_date))
      .sort((a, b) => (a.date < b.date ? 1 : -1));
  }

  async getPresence({ teacher_id, mobile, school_id, start_date, end_date }) {
    if (!teacher_id && !mobile && !school_id) {
      throw new Error('getPresence requires one of teacher_id, mobile, or school_id.');
    }
    const period_start = start_date || null;
    const period_end = end_date || null;

    if (school_id) {
      const teachers = await this.getTeachersBySchool(school_id);
      const records = await this.getAttendanceForSchool(school_id, period_start, period_end);
      const byTeacher = new Map();
      for (const r of records) {
        if (!byTeacher.has(r.teacher_id)) byTeacher.set(r.teacher_id, []);
        byTeacher.get(r.teacher_id).push(r);
      }
      return teachers.map((t) => ({
        teacher_id: t.id,
        mobile: t.phone_number,
        school_id,
        period_start,
        period_end,
        ...computePresence(byTeacher.get(t.id) || []),
      }));
    }

    let tid = teacher_id;
    let t = null;
    if (!tid && mobile) {
      t = this.teachers.find((x) => x.phone_number === mobile) || null;
      if (!t) {
        return {
          teacher_id: null, mobile, school_id: null,
          period_start, period_end,
          present_days: 0, absent_days: 0, leave_days: 0,
          working_days: 0, presence_pct: 0,
        };
      }
      tid = t.id;
    }
    if (tid && !t) t = this.teachers.find((x) => x.id === tid) || null;

    const records = await this.getAttendanceForTeacher(tid, period_start, period_end);
    return {
      teacher_id: tid,
      mobile: (t && t.phone_number) || mobile || null,
      school_id: t ? t.school_id : null,
      period_start,
      period_end,
      ...computePresence(records),
    };
  }
}

// ───────────────────────────────────────────────────────────────────────────────
// Factory
// ───────────────────────────────────────────────────────────────────────────────

/**
 * Returns the appropriate repository based on env.
 *   * ATTENDANCE_REPO=mock  or  NODE_ENV=test  → MockAttendanceRepository (empty seed)
 *   * otherwise                                → RealAttendanceRepository (needs supabase)
 */
function getAttendanceRepository(supabase) {
  const useMock = process.env.ATTENDANCE_REPO === 'mock' || process.env.NODE_ENV === 'test';
  if (useMock) return new MockAttendanceRepository();
  return new RealAttendanceRepository(supabase);
}

module.exports = {
  RealAttendanceRepository,
  MockAttendanceRepository,
  getAttendanceRepository,
  computePresence,
  validateStatusAndLeaveType,
};
