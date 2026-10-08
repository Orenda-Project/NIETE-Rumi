/**
 * bd-fmf24g.8 — every word the teacher v2 My Classes pages show (the feature's own copy file).
 *
 * Same rules as the new UI's copy (newui/copy.ts, DESIGN.md): 1–3 words, 4 at most, no sentences, no
 * question marks. English only for now; the Urdu pass gives each key an Urdu value. DATA is not copy:
 * grade, section, subject and shift labels and a child's name come from the API as they are.
 */
export const CLASSES_V2_COPY = {
  title: 'My Classes',
  home: 'Home',
  back: 'Back',
  classes: 'Classes',
  addClass: 'Add a class',
  noClassesYet: 'No classes yet',
  cannotAdd: 'No school on file',
  grade: (g: string | number = '') => `Grade ${g}`.trim(),
  classTeacher: 'Class teacher',
  /* Class detail */
  attendance: 'Attendance',
  lessonPlans: 'Lesson plans',
  students: 'Students',
  noStudentsYet: 'No students yet',
  showAll: (n: number) => `Show all ${n}`,
  addStudents: 'Add students',
  studentNames: 'Student names',
  add: 'Add',
  adding: 'Adding',
  added: (n: number) => (n === 1 ? '1 student added' : `${n} students added`),
  alreadyThere: (n: number) => `${n} already there`,
  notAdded: (n: number) => `${n} not added`,
  remove: 'Remove',
  removeNamed: (name: string) => `Remove ${name}`,
  removeStudent: 'Remove student',
  keep: 'Keep',
  close: 'Close',
  /* Add a class */
  classField: 'Class',
  section: 'Section',
  shift: 'Shift',
  subjects: 'Subjects',
  iAmClassTeacher: 'I am class teacher',
  saveClass: 'Save class',
  saving: 'Saving',
  /* loading and errors */
  loading: 'Loading',
  loadFailed: 'Could not load',
  saveFailed: 'Could not save',
  tryAgain: 'Try again',
} as const;

export type ClassesCopy = typeof CLASSES_V2_COPY;
