/**
 * bd-fmf24g.8 — every word the teacher v2 My Classes pages show (the feature's own copy file).
 *
 * Same rules as the new UI's copy (newui/copy.ts, DESIGN.md): 1–3 words, 4 at most, no sentences, no
 * question marks. DATA is not copy: grade, section, subject and shift labels and a child's name come from
 * the API as they are.
 *
 * bd-fmf24g.13 — bilingual: CLASSES = { en, ur }, read with useCopy(CLASSES). The Urdu is MACHINE-DRAFTED from
 * the bot's existing Urdu (ux-strings.js: میری کلاسیں، طلبہ شامل کریں، کلاس ٹیچر) and awaits a human review.
 */
import { bilingual, type Bilingual, type Words } from '../i18n';
import type { CopyEntry } from '../copyRegistry';

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

export type ClassesCopy = Words<typeof CLASSES_V2_COPY>;

/** bd-fmf24g.13 — My Classes' words in Urdu (MACHINE-DRAFTED; review pending). Western digits, as the bot. */
export const CLASSES_V2_COPY_UR: ClassesCopy = {
  title: 'میری کلاسیں',
  home: 'ہوم',
  back: 'واپس',
  classes: 'کلاسیں',
  addClass: 'کلاس شامل کریں',
  noClassesYet: 'ابھی کوئی کلاس نہیں',
  cannotAdd: 'اسکول درج نہیں',
  grade: (g: string | number = '') => `جماعت ${g}`.trim(),
  classTeacher: 'کلاس ٹیچر',
  attendance: 'حاضری',
  lessonPlans: 'لیسن پلان',
  students: 'طلبہ',
  noStudentsYet: 'کوئی طالب علم نہیں',
  showAll: (n: number) => `تمام ${n} دکھائیں`,
  addStudents: 'طلبہ شامل کریں',
  studentNames: 'طلبہ کے نام',
  add: 'شامل کریں',
  adding: 'شامل ہو رہے ہیں',
  added: (n: number) => (n === 1 ? '1 طالب علم شامل' : `${n} طلبہ شامل`),
  alreadyThere: (n: number) => `${n} پہلے سے موجود`,
  notAdded: (n: number) => `${n} شامل نہیں ہوئے`,
  remove: 'ہٹائیں',
  removeNamed: (name: string) => `${name} کو ہٹائیں`,
  removeStudent: 'طالب علم ہٹائیں',
  keep: 'رہنے دیں',
  close: 'بند کریں',
  classField: 'کلاس',
  section: 'سیکشن',
  shift: 'شفٹ',
  subjects: 'مضامین',
  iAmClassTeacher: 'میں کلاس ٹیچر ہوں',
  saveClass: 'کلاس محفوظ کریں',
  saving: 'محفوظ ہو رہا ہے',
  loading: 'لوڈ ہو رہا ہے',
  loadFailed: 'لوڈ نہیں ہو سکا',
  saveFailed: 'محفوظ نہیں ہو سکا',
  tryAgain: 'دوبارہ کوشش کریں',
};

/** My Classes' words in both languages. */
export const CLASSES = bilingual(CLASSES_V2_COPY, CLASSES_V2_COPY_UR);

/** Registered for the completeness checks and the review file (copyRegistry). */
export const COPY_ENTRY: CopyEntry = { screen: 'My Classes', module: CLASSES as Bilingual<unknown> };
