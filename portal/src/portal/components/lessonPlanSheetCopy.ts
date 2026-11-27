import { bilingual } from '../teacher/i18n';

/**
 * bd-kijmb8 (queue #318) — the words of the Lesson plan button, row and sheet, English and Urdu. "Lesson plan / لیسن پلان"
 * and "Recording continues" are the app's existing words (RecordingBar). The other Urdu is machine-drafted: NATIVE-CHECK.
 */
export const LESSON_PLAN_SHEET_COPY = bilingual(
  {
    lessonPlan: 'Lesson plan',
    open: 'Open',
    attach: 'Attach',
    nietePlan: 'NIETE plan',
    ownPlan: "Teacher's own plan",
    notReady: 'This lesson plan is not ready yet',
    close: 'Close',
  },
  {
    lessonPlan: 'لیسن پلان',
    open: 'کھولیں', // NATIVE-CHECK
    attach: 'لگائیں', // NATIVE-CHECK
    nietePlan: 'NIETE لیسن پلان', // NATIVE-CHECK
    ownPlan: 'ٹیچر کا اپنا لیسن پلان', // NATIVE-CHECK
    notReady: 'یہ لیسن پلان ابھی تیار نہیں', // NATIVE-CHECK
    close: 'بند کریں',
  },
);
