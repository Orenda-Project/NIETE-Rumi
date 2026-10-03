/**
 * bd-5rz1v.19 — the new UI kit. Every new screen is built from these; DESIGN.md says how and
 * when to use each, and checks/ fails the build when a rule is broken.
 */
export { MainHeading, type MainHeadingProps } from './MainHeading';
export { InnerBar, type InnerBarProps } from './InnerBar';
export { List, Row, ProgressBar, SectionLabel, type RowProps, type RowTile } from './List';
export { Chip, FilterChips, ToggleChips, type ChipProps, type ChipTone, type FilterOption, type ToggleChipsProps } from './Chip';
export { BottomButton, BottomActions, type BottomButtonProps, type BottomButtonTone } from './BottomButton';
export { MetricTile, MetricGrid, type MetricTileProps } from './MetricTile';
export { Sheet, type SheetProps } from './Sheet';
export { DateRangeButton, DateRangeSheet, type DateRangeButtonProps, type DateRangeSheetProps } from './DateRange';
export {
  DEFAULT_RANGE, RANGE_PRESETS, rangeLabel, rangeQuery, shortDate, pkToday,
  type DateRange, type DateRangeCopy, type RangeKey, type RangePreset,
} from './range';
export { NumberGrid, type NumberGridProps } from './NumberGrid';
export { Stepper, type StepperProps } from './Stepper';
export { ToggleList, type ToggleListProps, type ToggleOption } from './ToggleList';
export { Hero, type HeroProps } from './Hero';
export { Panel, Fold, type PanelProps, type FoldProps } from './Panel';
export { AnswerChoices, QuestionDots, type AnswerChoicesProps } from './Answers';
export { AudioPlayer, type AudioPlayerProps, type AudioPlayerCopy } from './AudioPlayer';
export { FeatureIcon, HeadingTile, type Feature } from './FeatureIcon';
export { KIT_COPY, NAV_COPY, MONTHS, ASSESSMENT_COPY } from './copy';
export { FOCUS, TAP, TAP_SQUARE, PRESS } from './styles';
