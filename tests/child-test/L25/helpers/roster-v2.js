/**
 * L25: the L3 synthetic roster plus what the v2 list needs: a shift per class, class teachers
 * (class_teachers + users), invented child and father names. Placeholder names only.
 *
 *   classes: [{ id, grade, section (null = no section), shift: 'morning'|'evening', size,
 *               names: ['Ali Hassan', { name, father }], teachers: [{ id, name, flagged, phone, deleted, active, endedOn }] }]
 */
const { buildRoster } = require('../../L3/helpers/roster');

// Same-name checks drop digits (R1 §4), so "Child 3A-01" and "Child 3A-02" would be namesakes: default
// names here differ in letters.
const alpha = (i) => { let s = ''; let n = i; do { s = String.fromCharCode(97 + (n % 26)) + s; n = Math.floor(n / 26) - 1; } while (n >= 0); return s; };

function buildRosterV2({ classes = [], ...rest } = {}) {
  const seed = buildRoster({ classes, ...rest });
  seed.users = [];
  seed.class_teachers = [];
  const seenUsers = new Set();
  for (const c of classes) {
    const cls = seed.classes.find((x) => x.id === c.id);
    if (Object.prototype.hasOwnProperty.call(c, 'section') && c.section == null) cls.section = null;
    cls.shift_code = c.shift || 'morning';
    for (const s of seed.students.filter((x) => x.id.startsWith(`${c.id}-st`))) {
      s.student_name = `Child ${alpha(Number(s.id.slice(-2)) - 1)} ${alpha(seed.classes.indexOf(cls))}`;
    }
    (c.names || []).forEach((n, i) => {
      const sid = `${c.id}-st${String(i + 1).padStart(2, '0')}`;
      const s = seed.students.find((x) => x.id === sid);
      if (!s) return;
      s.student_name = typeof n === 'string' ? n : n.name;
      s.father_name = typeof n === 'string' ? null : (n.father || null);
    });
    for (const t of c.teachers || []) {
      if (!seenUsers.has(t.id)) {
        seenUsers.add(t.id);
        seed.users.push({
          id: t.id, name: t.name === undefined ? `Teacher ${t.id}` : t.name, role: 'teacher',
          phone_number: t.phone === undefined ? `9230000${String(seed.users.length).padStart(5, '0')}` : t.phone,
          deleted_at: t.deleted ? '2026-09-01T00:00:00Z' : null, preferred_language: t.lang || 'ur',
        });
      }
      seed.class_teachers.push({
        id: `ct-${c.id}-${t.id}`, class_id: c.id, teacher_user_id: t.id, is_class_teacher: !!t.flagged,
        is_active: t.active !== false, ended_on: t.endedOn || null,
      });
    }
  }
  return seed;
}

module.exports = { buildRosterV2, alpha };
