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
  /** null until the session has been scored — never a stand-in zero. */
  maxScore: number | null;
  percentage: number | null;
  /** The framework she was actually scored on: 'fico' for every NIETE region. */
  framework?: string | null;
}

/**
 * One indicator inside a domain, with the quote from her own lesson that
 * justifies its score. This is the most useful thing in the payload and has
 * never been visible on any surface.
 */
export interface BreakdownIndicator {
  id: string | null;
  name: string | null;
  score: number | null;
  evidence: string | null;
  evidence_summary: string | null;
  /**
   * FICO gates seven Section F indicators on the subject, so a maths lesson is
   * scored out of 42 and a literacy one out of 44. `false` means the question
   * was never asked — not a mark she lost.
   */
  applicable: boolean;
}

/** One scored domain. `key` is the printed rubric's section letter (B/C/D/F). */
export interface BreakdownGroup {
  key: string;
  domainKey: string;
  name: string;
  score: number;
  max: number;
  pct: number;
  indicators: BreakdownIndicator[];
}

/**
 * The framework-correct score breakdown, built by the BOT.
 *
 * The portal names no framework and no domain: it renders what comes back, so
 * a sixth framework never requires a portal change. Groups arrive
 * strongest-first, so the weakest is last and is the one worth opening.
 */
export interface ScoreBreakdown {
  framework: string | null;
  language: string;
  overall: number | null;
  marks: number | null;
  max: number | null;
  groups: BreakdownGroup[];
}

/** A question Rumi asked her, and her own answer. Read-only on the portal. */
export interface ReflectionEntry {
  question: string | null;
  answer: string | null;
  language: string | null;
  asked_at: string | null;
  answered_at: string | null;
}

export interface PrioritizedAction {
  action?: string | null;
  commitment?: string | null;
  language?: string | null;
  /** Her yes/no, when she answered it on WhatsApp. */
  teacher_response?: string | null;
}

export interface AnalysisData {
  overall_score: {
    points: number;
    max_points: number | null;
    percentage: number | null;
  };
  executive_summary?: string | null;
  strengths: string[];
  growth_opportunities: string[];
  recommendations: string[];
  notable_moments?: unknown[];
  /** `{ status: 'lp_absent' }` when she attached no plan — honest, not a gap. */
  lp_fidelity?: { status?: string } | null;
  photo_analysis?: unknown;
}

export interface SessionDetail extends CoachingSession {
  status?: string;
  /** HER lesson recording. Present on 100% of sessions, never served before. */
  lessonAudioUrl?: string | null;
  /** The coach's spoken feedback — what the "Session Recording" player used to play. */
  debriefAudioUrl?: string | null;
  /** Legacy alias, now pointing at her lesson. */
  audioUrl?: string | null;
  transcript?: string;
  transcriptLanguage?: string | null;
  reportUrl?: string | null;
  /** 897 of 914 stored reports are png, despite the column name. */
  reportFormat?: 'png' | 'pdf';
  reportPdfUrl?: string | null;
  lessonPlanUrl?: string | null;
  hasLessonPlan?: boolean;
  photoUrls?: string[];
  breakdown?: ScoreBreakdown | null;
  reflection?: ReflectionEntry[];
  prioritizedAction?: PrioritizedAction | null;
  analysisData: AnalysisData;
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
  /** Averaged ACROSS sessions, not read off the latest one. */
  percentage: number;
  /** How many sessions this domain was scored in. */
  sessions?: number;
}

export interface AnalyticsInsights {
  totalSessions: number;
  averageScore: number;
  improvement: number;
  /** null until something has been scored — never a guess. */
  bestGoalArea: string | null;
  focusArea: string | null;
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


export interface RosterStudent {
  studentId: string;
  studentName: string;
  fatherName: string | null;
  rollNumber: number | null;
  enrolledOn: string | null;
}

export interface AddStudentsResponse {
  success: boolean;
  /** How many children were actually enrolled. */
  added?: number;
  /** Already on the roster, or repeated within the paste — not an error. */
  duplicates?: number;
  /** Cut by the paste cap. Surfaced so nobody wonders where their students went. */
  dropped?: number;
  error?: string;
}
