/**
 * bd-fmf24g.2 — the teacher app v2's shared kit (behind `portal_teacher_v2`), ported from the v28 canvas and its
 * spec (versions/v28_teacher-polish/COMPONENTS.md in the NIETE Portal Coaching report folder). How to use each:
 * README.md beside this file. Feature icons: ../icons.
 */
export { TEACHER_UI_COPY, type NotifyCopy, type ReportCopy, type TeacherUiCopy } from './copy';
export { CHIP_TONE, type ChipData, type ChipTone } from './styles';
export { StatusChip, type StatusChipProps } from './StatusChip';
export {
  gradeSubjectLabel, subjectFamily, subjectIcon, subjectShort, SUBJECT_SHORT, type SubjectFamily, type SubjectIconKey, type SubjectShortForm,
} from './subjects';
export { SubjectTile, type SubjectTileProps, type SubjectTileTone } from './SubjectTile';
export { GradeSubjectButton, type GradeSubjectButtonProps, type GradeSubjectState } from './GradeSubjectButton';
export { HistoryRow, leadColours, type HistoryAction, type HistoryRowProps, type LeadColours } from './HistoryRow';
export { HistoryList, type HistoryGroup, type HistoryItem, type HistoryListProps } from './HistoryList';
export { ListRow, type ListRowIcon, type ListRowProps, type ListRowState } from './ListRow';
export { Tray, type TrayProps } from './Tray';
export { ReadyTray, trayHeight, type ReadyTrayProps, type TrayRow } from './ReadyTray';
export { ReadyBanner, type BannerRow, type ReadyBannerProps } from './ReadyBanner';
export { LeaveNote } from './LeaveNote';
export {
  ASSESSMENT_SUBJECTS_BY_GRADE, LESSON_SUBJECTS_BY_GRADE, subjectsByGradeFor, type SubjectsByGrade, type TeacherCatalogueFeature,
} from './catalogue';
export {
  ClassPicker, type ClassPick, type ClassPickerProps, type GradeSubjectCombo, type GradeSubjectPair,
} from './ClassPicker';
export { formatSpan, resolveRange, type ResolvedRange } from './range';
export { DateRangeBar, type DateRangeBarProps, type DateRangeInfo } from './DateRangeBar';
export { KpiTiles, type KpiItem, type KpiTilesProps } from './KpiTiles';
export { ProgressSteps, type ProgressStep, type ProgressStepsProps } from './ProgressSteps';
export { VoiceNote, type VoiceNoteProps } from './VoiceNote';
export { ReportBody, type ReportBodyProps, type ReportData, type ReportScore } from './ReportBody';
