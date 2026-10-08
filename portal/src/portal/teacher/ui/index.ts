/**
 * bd-fmf24g.2 — the teacher app v2's shared kit (behind `portal_teacher_v2`), ported from the v28 canvas and its
 * spec (versions/v28_teacher-polish/COMPONENTS.md in the NIETE Portal Coaching report folder). How to use each:
 * README.md beside this file. Feature icons: ../icons.
 */
export { TEACHER_UI_COPY, type ReportCopy, type TeacherUiCopy } from './copy';
export { CHIP_TONE, type ChipData, type ChipTone } from './styles';
export { StatusChip, type StatusChipProps } from './StatusChip';
export { blockSubject, gradeSubjectLabel, subjectIcon, type SubjectIconKey } from './subjects';
export { SubjectTile, type SubjectTileProps, type SubjectTileTone } from './SubjectTile';
export { GradeSubjectButton, type GradeSubjectButtonProps, type GradeSubjectState } from './GradeSubjectButton';
export { HistoryRow, type HistoryAction, type HistoryRowProps } from './HistoryRow';
export { HistoryList, type HistoryGroup, type HistoryItem, type HistoryListProps } from './HistoryList';
export { ListRow, type ListRowIcon, type ListRowProps, type ListRowState } from './ListRow';
export { Tray, type TrayProps } from './Tray';
export {
  ASSESSMENT_SUBJECTS_BY_GRADE, LESSON_SUBJECTS_BY_GRADE, subjectsByGradeFor, type SubjectsByGrade, type TeacherCatalogueFeature,
} from './catalogue';
export { GradeSubjectSelector, type GradeSubjectSelectorProps, type GradeSubjectValue } from './GradeSubjectSelector';
export {
  GradeSubjectPicker, type GradeSubjectCombo, type GradeSubjectPair, type GradeSubjectPickerProps,
} from './GradeSubjectPicker';
export { formatSpan, resolveRange, type ResolvedRange } from './range';
export { DateRangeBar, type DateRangeBarProps, type DateRangeInfo } from './DateRangeBar';
export { KpiTiles, type KpiItem, type KpiTilesProps } from './KpiTiles';
export { ProgressSteps, type ProgressStep, type ProgressStepsProps } from './ProgressSteps';
export { VoiceNote, type VoiceNoteProps } from './VoiceNote';
export { ReportBody, type ReportBodyProps, type ReportData, type ReportScore } from './ReportBody';
