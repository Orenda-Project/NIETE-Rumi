/**
 * bd-fmf24g.2 — the teacher app v2's shared kit (behind `portal_teacher_v2`), ported from the v28 canvas and its
 * spec (versions/v28_teacher-polish/COMPONENTS.md in the NIETE Portal Coaching report folder). How to use each:
 * README.md beside this file. Feature icons: ../icons.
 */
export { TEACHER_UI_COPY, type NotifyCopy, type ReportCopy, type ShareCopy, type TeacherUiCopy } from './copy';
export { CHIP_TONE, type ChipData, type ChipTone } from './styles';
export { StatusChip, type StatusChipProps } from './StatusChip';
export {
  gradeSubjectLabel, subjectFamily, subjectIcon, subjectShort, SUBJECT_SHORT, type SubjectFamily, type SubjectIconKey, type SubjectShortForm,
} from './subjects';
export { SubjectTile, type SubjectTileProps, type SubjectTileTone } from './SubjectTile';
export { GradeSubjectButton, type GradeSubjectButtonProps, type GradeSubjectState } from './GradeSubjectButton';
export { GRADE_COLOURS, NEUTRAL_COLOURS, gradeColoursFor, type GradeColours } from './gradeColours';
export {
  HistoryRow, leadColours, type HistoryAction, type HistoryLead, type HistoryLeadTone, type HistoryRowProps, type HistoryRowState, type LeadColours,
} from './HistoryRow';
export { HistoryList, type HistoryGroup, type HistoryItem, type HistoryListProps } from './HistoryList';
export { ListRow, type ListRowIcon, type ListRowProps, type ListRowState } from './ListRow';
export { Tray, type TrayProps } from './Tray';
export { ReadyTray, trayHeight, type ReadyTrayProps, type TrayRow } from './ReadyTray';
export { ReadyBanner, type BannerRow, type ReadyBannerProps } from './ReadyBanner';
export { LeaveNote } from './LeaveNote';
export { ReadyCard, type ReadyCardProps, type ReadyCardRow } from './ReadyCard';
export { NoticeIcon } from './NoticeIcon';
export {
  ASSESSMENT_SUBJECTS_BY_GRADE, LESSON_SUBJECTS_BY_GRADE, subjectsByGradeFor, type SubjectsByGrade, type TeacherCatalogueFeature,
} from './catalogue';
export {
  ClassPicker, type ClassPick, type ClassPickerProps, type GradeSubjectCombo, type GradeSubjectPair,
} from './ClassPicker';
export { formatSpan, resolveRange, type ResolvedRange } from './range';
export { DateRangeBar, type DateRangeBarProps, type DateRangeInfo } from './DateRangeBar';
export { FeatureCard, MeterRow, type FeatureCardProps, type MeterRowProps } from './FeatureCard';
export { KpiTiles, type KpiItem, type KpiTilesProps } from './KpiTiles';
export { ProgressSteps, type ProgressStep, type ProgressStepsProps } from './ProgressSteps';
export { VoiceNote, type VoiceNoteProps } from './VoiceNote';
export { ReportBody, type ReportBodyProps, type ReportData, type ReportScore } from './ReportBody';
export { HomeGreeting, type HomeGreetingProps } from './HomeGreeting';
export { TimeStamp, parseTime, type Meridiem, type TimeStampProps, type TimeTone } from './TimeStamp';
export { ChosenSoFar, type ChosenItem, type ChosenSoFarProps } from './ChosenSoFar';
export { AttentionBanner, type AttentionBannerProps } from './AttentionBanner';
export { FeatureTile, type FeatureTileProps } from './FeatureTile';
export { addDays, dayNumber, weekdayOf, weekOf } from './dates';
export { DayStrip, type DayStripProps } from './DayStrip';
export { TimePicker, PICKER_HOURS, type TimePickerProps } from './TimePicker';
export { StepBar, type StepBarProps } from './StepBar';
export { RatingScale, type RatingScaleProps, type RatingValue } from './RatingScale';
export { SlotGroup, type SlotGroupProps, type SlotPerson } from './SlotGroup';
export { SelectField, type SelectFieldProps, type SelectOption } from './SelectField';
export { Tabs, type TabItem, type TabsProps } from './Tabs';
export { ChoiceChips, type ChipOption, type ChoiceChipsProps } from './ChoiceChips';
export { StatStrip, type StatItem, type StatStripProps } from './StatStrip';
export { ScoreRing, type ScoreRingProps } from './ScoreRing';
export { TrendChart, type TrendChartProps, type TrendPoint } from './TrendChart';
export { AudioCard, type AudioCardProps } from './AudioCard';
export { RecordUploadPair, type PairAction, type RecordUploadPairProps } from './RecordUploadPair';
export { NumberField, type NumberFieldProps } from './NumberField';
export { ButtonWithReason, type ButtonWithReasonProps } from './ButtonWithReason';
export { digitsOnly } from './digits';
export { ShareActions, intentUrl, clockOf, PAGE_HANDOFF, type OpenTarget, type ShareActionsProps, type ShareResult } from './ShareActions';
