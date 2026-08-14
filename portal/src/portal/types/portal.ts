export interface User {
  firstName: string;
  lastName: string;
  phoneNumber: string;
  /** The user's registered country (users.country on the API). Optional
   *  because older API responses may omit it. */
  country?: string | null;
  /**
   * bd-2434 (Leader Portal): the user's role (users.role on the API). Decides
   * whether the portal shows the school-leader dashboard vs the teacher
   * experience. Optional because older API responses may omit it (→ teacher).
   * See src/portal/lib/leaderRole.ts (LEADER_ROLES / isLeader).
   */
  role?: string | null;
}

export interface DashboardStats {
  totalLessonPlans: number;
  totalCoachingSessions: number;
}

export interface LessonPlan {
  id: string;
  title: string;
  subject?: string;
  grade_level?: string;
  content_type: 'lesson_plan' | 'presentation';
  gamma_url?: string;
  pdf_url?: string;
  created_at: string;
}

export interface CoachingSession {
  id: string;
  date: string;
  duration: number;
  overallScore: number;
  maxScore: number;
  percentage: number;
}

export interface GoalScore {
  goal: string;
  points: number;
  max_points: number;
  percentage: number;
}

export interface CriterionScore {
  criterion: string;
  points: number;
  max_points: number;
  percentage: number;
}

export interface AnalysisData {
  overall_score: {
    points: number;
    max_points: number;
    percentage: number;
  };
  goal_scores: GoalScore[];
  criterion_scores: CriterionScore[];
  strengths: string[];
  growth_opportunities: string[];
  recommendations: string[];
}

export interface SessionDetail extends CoachingSession {
  audioUrl?: string;
  transcript?: string;
  analysisData: AnalysisData;
  reportPdfUrl?: string;
}

export interface ScoreTrend {
  date: string;
  score: number;
  percentage: number;
}

export interface GoalBreakdown {
  name: string;
  score: number;
  maxScore: number;
  percentage: number;
}

export interface AnalyticsInsights {
  totalSessions: number;
  averageScore: number;
  improvement: number;
  bestGoalArea: string;
  focusArea: string;
}

export interface CoachingAnalytics {
  overallScoreTrend: ScoreTrend[];
  goalAreaBreakdown: GoalBreakdown[];
  insights: AnalyticsInsights;
}

export interface Pagination {
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

export interface ApiResponse<T> {
  success: boolean;
  error?: string;
  data?: T;
}

// Issue #7: Video Library Types
export interface VideoRequest {
  id: string;
  topic: string;
  language: string;
  status: 'pending' | 'processing' | 'completed' | 'failed';
  video_url?: string;
  pdf_url?: string;
  slide_urls?: string[];
  thumbnailUrl?: string; // Presigned URL from backend
  generation_time_seconds?: number;
  created_at: string;
  completed_at?: string;
}

export interface VideoSlide {
  slideId: number;
  title: string;
  narration: string;
  startUrl?: string;
  endUrl?: string;
}

export interface VideoDetail extends VideoRequest {
  script_data?: {
    slides: VideoSlide[];
    audioDurations: number[];
  };
  slide_urls?: string[];
  thumbnailUrl?: string; // Presigned URL from backend
  current_step?: number;
  error_message?: string;
}

// ============================================================================
// Leader Portal (bd-2434) — the school-leader "My Patch" surface.
// ============================================================================

/** One teacher in a leader's patch (leader_teachers ∩ Rumi activity). */
export interface LeaderPatchTeacher {
  teacherExtId: string | null;
  name: string | null;
  phone: string | null;
  onRumi: boolean;
  rumiUserId: string | null;
  coachingSessions: number;   // sessions the teacher recorded herself
  observations: number;       // bd-2671: visits by a coach (/observe)
  lessonPlans: number;
  lastSessionAt: string | null;
  lastScore: number | null;   // framework-agnostic %, null if never coached
  focusArea: string | null;   // bd-2672: the named area, not just "Focus Area"
  schoolName: string | null;
  emis: string | null;
}

/** My Patch headline KPIs + focus list (GET /leader/overview). */
export interface LeaderOverview {
  totalTeachers: number;
  onRumi: number;
  notOnRumi: number;
  totalCoachingSessions: number;
  totalLessonPlans: number;
  scoredTeachers: number;
  avgLastScore: number | null;
  focus: LeaderPatchTeacher[];
}

/** The coach's /observe world (GET /leader/observations) — bd-2455. */
export interface LeaderScheduledObservation {
  id: string;
  teacherName: string | null;
  schoolName: string | null;
  schoolExtId: string | null;
  teacherExtId: string | null;
  scheduledFor: string | null;   // YYYY-MM-DD
  scheduledSlot: string | null;  // e.g. "09:30"
  overdue: boolean;
}

export interface LeaderObservationSession {
  id: string;
  createdAt: string | null;
  // bd-2670: resolved from the linked schedule → the name given at send →
  // the bound teacher's account. Null only when nothing identifies her.
  teacherName: string | null;
  teacherUserId: string | null;
  schoolName: string | null;
  emis: string | null;           // '509' from school_ext_id 'niete:509'
  status: string;
  debriefStatus: string | null;
  score: number | null;          // framework-agnostic %
  reportPdfUrl: string | null;
}

export interface LeaderObservationsData {
  upcoming: LeaderScheduledObservation[];
  pendingDebriefs: LeaderObservationSession[];
  completed: LeaderObservationSession[];
}

/** Single teacher detail (GET /leader/teacher/:id) — patch-membership guarded. */
export interface LeaderTeacherDetail {
  teacher: { rumiUserId: string; name: string; phone: string; onRumi: boolean };
  stats: {
    coachingSessions: number;
    lessonPlans: number;
    readingAssessments: number;
    lastScore: number | null;
  };
  sessions: Array<{
    id: string;
    date: string;
    score: number | null;
    points: number | null;
    maxPoints: number | null;
  }>;
}


// ---------------------------------------------------------------------------
// Classes
//
// `gradeLabel` / `subjects[].label` arrive already localised for this teacher —
// the labels live in ONE catalog in the bot process, so the portal never keeps a
// second copy of the grade or subject vocabulary. `gradeCode` / `subjects[].code`
// are the canonical reference-table codes and are what any logic should key on.
// ---------------------------------------------------------------------------

export interface ClassSubject {
  code: string;
  label: string;
}

export interface TeacherClass {
  classId: string;
  gradeCode: string;
  gradeLabel: string;
  section: string | null;
  shiftCode: string;
  sessionCode: string;
  isClassTeacher: boolean;
  /** "Grade 4 - A", ready to render. */
  display: string;
  subjects: ClassSubject[];
}

export interface ClassOption {
  code: string;
  label: string;
}

export interface ClassesResponse {
  success: boolean;
  classes: TeacherClass[];
  /** False when the account cannot yet have a class created (no school on file). */
  canAdd: boolean;
  currentSession: string | null;
  grades: ClassOption[];
  subjects: ClassOption[];
  /** Closed vocabularies. A section support adds appears here without a deploy. */
  sections: ClassOption[];
  shifts: ClassOption[];
}

export interface CreateClassPayload {
  gradeCode: string;
  section?: string | null;
  shiftCode?: string;
  subjectCodes?: string[];
  isClassTeacher?: boolean;
}

export interface CreateClassResponse {
  success: boolean;
  class?: {
    classId: string;
    gradeCode: string;
    section: string | null;
    sessionCode: string;
  };
  created?: boolean;
  /** Reported alongside success: the class was saved, these claims were declined. */
  classTeacherTaken?: boolean;
  subjectsTaken?: string[];
  error?: string;
}
