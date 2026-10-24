import {
  AudioLines, Award, BookOpen, CalendarCheck, ChartColumn, Ellipsis, Eye, FilePenLine, GraduationCap, House, Languages,
  ListChecks, Users, type LucideIcon,
} from "lucide-react";
import type { HomeTileKey } from "../api";

/** Everything the Home look draws a glyph for: the eight features, the menu's Home and More, the language pill, the lesson card, the progress strip. */
export type LookIconKey = HomeTileKey | "home" | "more" | "language" | "lessonCard" | "progress";

/** The look's glyphs (lucide-react, already in the bundle; each import is tree-shaken to the one icon). */
export const LOOK_ICONS: Record<LookIconKey, LucideIcon> = {
  lessons: BookOpen,
  coaching: AudioLines,
  observations: Eye,
  training: GraduationCap,
  assessment: FilePenLine,
  attendance: CalendarCheck,
  classes: Users,
  analytics: ChartColumn,
  home: House,
  more: Ellipsis,
  language: Languages,
  lessonCard: ListChecks,
  progress: Award,
};
