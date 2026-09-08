/**
 * Attendance — edit-class Flow endpoint (data_exchange, encrypted).
 *
 * Screens: ROSTER → ADD | REMOVE | RENAME → SAVED
 * (docs/flows/edit-class-flow.json)
 *
 * Adding reuses the SAME paste parser as class setup, so a teacher learns the
 * interaction once. Removing is a CheckboxGroup over the live roster; renaming is
 * a deliberately narrow path because it is the rare case.
 *
 * flow_token is "<userId>:<listId>".
 */

const supabase = require('../config/supabase');
const { logToFile } = require('../utils/logger');
const { parseRoster } = require('./attendance-setup-endpoint');

const pending = new Map();

const ACTIONS = [
  { id: 'add', title: 'Add more students' },
  { id: 'remove', title: 'Remove students' },
  { id: 'rename', title: 'Fix a name' },
];

function parseToken(flowToken) {
  const [userId, listId] = String(flowToken || '').split(':');
  return { userId, listId };
}

async function loadClass(listId) {
  const { data } = await supabase
    .from('student_lists')
    // class_id decides whether membership lives in class_enrollments or only here.
    // Adding a child without it writes half the fact — see handleAdd (bd-dz6qb.2).
    .select('id, class_name, section, class_id')
    .eq('id', listId)
    .maybeSingle();
  return data || null;
}

async function loadRoster(listId) {
  const { data } = await supabase
    .from('students')
    .select('id, student_name, roll_number')
    .eq('list_id', listId)
    .eq('is_active', true)
    .order('roll_number');
  return data || [];
}

function classLabel(cls) {
  if (!cls) return 'Your class';
  return cls.section ? `${cls.class_name} - ${cls.section}` : cls.class_name;
}

function previewOf(roster) {
  const shown = roster.slice(0, 10).map((s, i) => `${i + 1}. ${s.student_name}`).join('\n');
  return roster.length > 10 ? `${shown}\n…and ${roster.length - 10} more` : shown;
}

/** Keep student_count honest — the portal and reports read it. */
async function syncCount(listId) {
  const roster = await loadRoster(listId);
  await supabase.from('student_lists').update({ student_count: roster.length }).eq('id', listId);
  return roster;
}

async function handleEditClassInit(flowToken) {
  const { listId } = parseToken(flowToken);
  const [cls, roster] = await Promise.all([loadClass(listId), loadRoster(listId)]);
  pending.set(flowToken, { listId });

  return {
    screen: 'ROSTER',
    data: {
      heading: `${classLabel(cls)} · ${roster.length} students`,
      preview: roster.length ? previewOf(roster) : 'No students yet.',
      actions: ACTIONS,
    },
  };
}

async function handleActionChoice(flowToken, screenData) {
  const { listId } = parseToken(flowToken);
  // NOT `action`: a form field of that name collides with the data_exchange
  // envelope's own top-level `action` and never reaches us. `action` stays as a
  // fallback for handsets still holding the previously published asset.
  const action = screenData?.roster_action ?? screenData?.action;
  const [cls, roster] = await Promise.all([loadClass(listId), loadRoster(listId)]);

  if (action === 'add') {
    return { screen: 'ADD', data: { class_display: classLabel(cls) } };
  }
  if (action === 'remove') {
    if (!roster.length) {
      return { screen: 'SAVED', data: { heading: 'Nothing to remove', detail: 'This class has no students yet.' } };
    }
    return {
      screen: 'REMOVE',
      data: {
        class_display: classLabel(cls),
        roster: roster.map((s) => ({ id: s.id, title: s.student_name })),
      },
    };
  }
  if (action === 'rename') {
    if (!roster.length) {
      return { screen: 'SAVED', data: { heading: 'Nothing to rename', detail: 'This class has no students yet.' } };
    }
    return { screen: 'RENAME', data: { roster: roster.map((s) => ({ id: s.id, title: s.student_name })) } };
  }
  return handleEditClassInit(flowToken);
}

/** ADD — the same paste box as setup; anyone already listed is skipped. */
async function handleAdd(flowToken, screenData) {
  const { listId } = parseToken(flowToken);
  const names = parseRoster(screenData?.roster);
  const existing = await loadRoster(listId);

  if (!names.length) {
    const cls = await loadClass(listId);
    return {
      screen: 'ADD',
      data: { class_display: `${classLabel(cls)} — I couldn't find any names in that. One name per line.` },
    };
  }

  const have = new Set(existing.map((s) => (s.student_name || '').toLowerCase()));
  const fresh = names.filter((n) => !have.has(n.toLowerCase()));

  if (!fresh.length) {
    return {
      screen: 'SAVED',
      data: { heading: 'Everyone was already on the list', detail: 'Nothing to add.' },
    };
  }

  const startRoll = existing.reduce((max, s) => Math.max(max, s.roll_number || 0), 0);
  const { data: inserted, error } = await supabase.from('students').insert(
    fresh.map((student_name, i) => ({ list_id: listId, student_name, roll_number: startRoll + i + 1 })),
  ).select('id, roll_number');

  if (error) {
    logToFile('❌ edit-class add failed', { listId, error: error.message });
    return { screen: 'SAVED', data: { heading: 'Could not add them', detail: 'Please try again.' } };
  }

  // A students row carrying list_id is HALF the fact. Where the list is class-backed,
  // membership lives in class_enrollments — /class reads nothing else, and /attendance
  // stops falling back to the legacy list the moment a class has any enrolment at all.
  // Writing only the first half is how 415 children on production ended up on a list
  // that neither screen would show (bd-dz6qb.2).
  //
  // Through ClassService, which owns that table (root rule 15 — one writer per fact),
  // and specifically through enrollStudent rather than addStudents: addStudents refuses
  // a caller who is not assigned to the class, and this Flow is reached by whoever holds
  // the list, so routing through it would turn a half-written add into a silent no-op.
  const cls = await loadClass(listId);
  if (cls && cls.class_id) {
    // eslint-disable-next-line global-require
    const ClassService = require('../services/classes/class.service');
    for (const row of inserted || []) {
      // eslint-disable-next-line no-await-in-loop
      const res = await ClassService.enrollStudent({
        classId: cls.class_id, studentId: row.id, rollNumber: row.roll_number,
        enrolledOn: new Date().toISOString().slice(0, 10),
      });
      // A failed enrolment must not discard the add — the child is already written and
      // the teacher can see her in attendance's legacy fallback. Loud, not fatal.
      if (res.error) {
        logToFile('⚠️ edit-class: child added but not enrolled', {
          listId, classId: cls.class_id, studentId: row.id, error: res.error,
        }, 'error');
      }
    }
  }

  const roster = await syncCount(listId);
  const skipped = names.length - fresh.length;
  return {
    screen: 'SAVED',
    data: {
      heading: `Added ${fresh.length} — ${roster.length} students now`,
      detail: skipped ? `${skipped} were already on the list, so I skipped them.` : 'All saved.',
    },
  };
}

/**
 * REMOVE — soft delete. Past registers still reference these students, so
 * deleting the rows outright would corrupt history.
 */
async function handleRemove(flowToken, screenData) {
  const { listId } = parseToken(flowToken);
  const ids = screenData?.remove_ids || [];

  if (!ids.length) {
    return { screen: 'SAVED', data: { heading: 'Nobody selected', detail: 'Nothing was removed.' } };
  }

  const { error } = await supabase
    .from('students')
    .update({ is_active: false })
    .in('id', ids);

  if (error) {
    logToFile('❌ edit-class remove failed', { listId, error: error.message });
    return { screen: 'SAVED', data: { heading: 'Could not remove them', detail: 'Please try again.' } };
  }

  const roster = await syncCount(listId);
  return {
    screen: 'SAVED',
    data: {
      heading: `Removed ${ids.length} — ${roster.length} students now`,
      detail: 'Past registers are unchanged; only future ones use the new list.',
    },
  };
}

async function handleRename(flowToken, screenData) {
  const { listId } = parseToken(flowToken);
  const studentId = screenData?.student_id;
  const newName = (screenData?.new_name || '').trim();

  if (!studentId || !newName) {
    const roster = await loadRoster(listId);
    return { screen: 'RENAME', data: { roster: roster.map((s) => ({ id: s.id, title: s.student_name })) } };
  }

  const { error } = await supabase
    .from('students')
    .update({ student_name: newName })
    .eq('id', studentId)
    .eq('list_id', listId);   // scope to this class — never rename another teacher's student

  if (error) {
    logToFile('❌ edit-class rename failed', { listId, error: error.message });
    return { screen: 'SAVED', data: { heading: 'Could not save that name', detail: 'Please try again.' } };
  }

  return { screen: 'SAVED', data: { heading: 'Name updated', detail: `Now shown as ${newName}.` } };
}

async function handleEditClassDataExchange(flowToken, screen, screenData) {
  logToFile('📋 edit-class data_exchange', { screen });
  if (screen === 'ROSTER') return handleActionChoice(flowToken, screenData);
  if (screen === 'ADD') return handleAdd(flowToken, screenData);
  if (screen === 'REMOVE') return handleRemove(flowToken, screenData);
  if (screen === 'RENAME') return handleRename(flowToken, screenData);
  return handleEditClassInit(flowToken);
}

module.exports = {
  handleEditClassInit,
  handleEditClassDataExchange,
  parseToken,
};
