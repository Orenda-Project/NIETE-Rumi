import axios from 'axios';
import { getApiBaseUrl } from '@/lib/runtime';
import type { User, DashboardStats, LessonPlan, CoachingSession, SessionDetail, CoachingAnalytics, Pagination, VideoRequest, VideoDetail, LeaderOverview, LeaderPatchTeacher, LeaderTeacherDetail, LeaderObservationsData, SchoolAnalyticsResponse,
  AttendanceResponse } from '../types/portal';
import type { ReadingAssessment, ReadingAssessmentDetail, ReadingStats } from '../types/readingAssessment';
import type { MyAnalyticsResponse, ClassesResponse, CreateClassPayload, CreateClassResponse, RosterStudent, AddStudentsResponse, CoachingProgress } from '../types/portal';
import type { CoachHomeData, CoachScheduleData, TeamData, PeopleData, SchoolData, TeacherData, VisitData, ReportsData, ObservationReport } from '../coach/types';

// On the web, frontend and backend share a domain, so a relative URL avoids
// CORS and third-party cookies entirely. In the Capacitor app there is no
// such origin — the WebView serves from localhost — so an absolute URL
// (VITE_API_BASE_URL) is required. getApiBaseUrl() picks the right one and
// fails loudly if a native build is missing its config.
const API_BASE_URL = getApiBaseUrl();

const api = axios.create({
  baseURL: API_BASE_URL,
  withCredentials: true, // CRITICAL: Includes session cookies
  headers: { 
    'Content-Type': 'application/json' 
  }
});

// Global error interceptor
api.interceptors.response.use(
  (response) => response,
  (error) => {
    // Session expired - redirect to login
    if (error.response?.status === 401) {
      const currentPath = window.location.pathname;
      // Don't redirect if already on login/setup pages
      if (!currentPath.includes('/portal/login') && 
          !currentPath.includes('/portal/setup') &&
          !currentPath.includes('/portal/reset-password')) {
        window.location.href = '/portal/login';
      }
    }
    return Promise.reject(error);
  }
);

// Auth endpoints
export const auth = {
  validateToken: async (token: string) => {
    const response = await api.post('/validate-token', { token });
    return response.data;
  },
  
  setup: async (token: string, password: string) => {
    const response = await api.post('/setup', { token, password });
    return response.data;
  },
  
  login: async (phoneNumber: string, password: string) => {
    const response = await api.post('/login', { phoneNumber, password });
    return response.data;
  },
  
  logout: async () => {
    const response = await api.post('/logout');
    return response.data;
  },
  
  requestReset: async (phoneNumber: string) => {
    const response = await api.post('/request-reset', { phoneNumber });
    return response.data;
  },
  
  verifyResetCode: async (phoneNumber: string, code: string) => {
    const response = await api.post('/verify-reset-code', { phoneNumber, code });
    return response.data;
  },
  
  resetPassword: async (password: string) => {
    const response = await api.post('/reset-password', { password });
    return response.data;
  }
};

// Data endpoints
// The teacher's ONE language setting, shared with the bot.
//
// The portal used to decide its own language from the browser and write nothing
// back, so it could disagree with every WhatsApp message she received. These two
// calls make the portal a reader and a writer of the same setting.
export const language = {
  get: async (): Promise<{ language: string; locked: boolean }> => {
    const response = await api.get('/me/language');
    return { language: response.data.language, locked: response.data.locked };
  },

  set: async (language: string): Promise<void> => {
    // Throws on rejection so the caller does NOT re-render into a language the
    // bot never accepted.
    await api.put('/me/language', { language });
  },
};

export const portal = {
  getDashboard: async (): Promise<{
    user: User;
    stats: DashboardStats;
    recentLessonPlans: LessonPlan[];
    recentCoachingSession?: CoachingSession;
  }> => {
    const response = await api.get('/dashboard');
    return response.data;
  },

  /** bd-fxk3t8 — who is signed in: the same user as getDashboard, without its counts. */
  getMe: async (): Promise<{ success: boolean; user: User }> => {
    const response = await api.get('/me');
    return response.data;
  },
  
  getLessonPlans: async (page = 1, limit = 20, type?: string): Promise<{
    lessonPlans: LessonPlan[];
    pagination: Pagination;
  }> => {
    const response = await api.get('/lesson-plans', { 
      params: { page, limit, type } 
    });
    return response.data;
  },
  
  getCoachingSessions: async (page = 1, limit = 20): Promise<{
    sessions: CoachingSession[];
    pagination: Pagination;
  }> => {
    const response = await api.get('/coaching-sessions', { 
      params: { page, limit } 
    });
    return response.data;
  },
  
  getCoachingSession: async (id: string): Promise<{
    session: SessionDetail;
  }> => {
    const response = await api.get(`/coaching-session/${id}`);
    return response.data;
  },
  
  getCoachingAnalytics: async (): Promise<{
    analytics: CoachingAnalytics;
  }> => {
    const response = await api.get('/coaching-analytics');
    return response.data;
  },

  // ── bd-7hyj7: teacher self-observation from the portal ───────────────────

  /** Sign a direct-to-R2 upload for one file. */
  presignCoachingUpload: async (args: {
    filename: string; sizeBytes: number; kind: 'audio' | 'lesson_plan' | 'photo';
  }): Promise<{ key: string; uploadUrl: string; contentType: string }> => {
    const response = await api.post('/coaching-upload/presign', args);
    return response.data;
  },

  /**
   * PUT the file straight to R2. Plain XHR rather than the `api` instance: it
   * reports upload progress, and it sends NO session cookie — R2 does not need
   * it, and a credentialed cross-origin request would need a stricter CORS rule.
   * The Content-Type must be exactly the signed one or R2 rejects the PUT.
   */
  uploadToR2: (
    uploadUrl: string, file: Blob, contentType: string, onProgress?: (loaded: number, total: number) => void,
  ): Promise<void> => new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('PUT', uploadUrl);
    xhr.setRequestHeader('Content-Type', contentType);
    xhr.upload.onprogress = (e) => { if (onProgress && e.lengthComputable) onProgress(e.loaded, e.total); };
    xhr.onload = () => (xhr.status >= 200 && xhr.status < 300
      ? resolve()
      : reject(new Error(`upload failed (${xhr.status})`)));
    xhr.onerror = () => reject(new Error('upload failed (network)'));
    xhr.send(file);
  }),

  /**
   * Start the analysis. A 409 (one already running) rejects with err.response.
   * `lessonPlan` (bd-5rz1v) is a library pick instead of an uploaded plan.
   */
  startCoachingUpload: async (args: {
    key: string; lessonPlanKey?: string; photoKeys: string[];
    lessonPlan?: { assetId: string } | { lessonId: string } | { segmentId: string; lang: 'en' | 'ur' };
    /** bd-fmf24g.9: the class she picked in the teacher app (grade 1–12 and her subject). */
    teacherClass?: { grade: number; subject: string; subjectKey?: string };
  }): Promise<{ coachingSessionId: string }> => {
    const response = await api.post('/coaching-upload/start', args);
    return response.data;
  },

  // ── bd-5rz1v: a lesson plan from the library, for "Record your class" ─────

  /** Her recent plans — what the WhatsApp "Recent Lesson Plans" list offers. */
  getRecentLessonPlans: async (): Promise<{ plans: RecentLessonPlan[] }> => {
    const response = await api.get('/coaching-upload/recent-plans');
    return response.data;
  },

  /**
   * The library, one step at a time. Grades 1-5 and 6-12 are two catalogues
   * behind one picker (as on the Curriculum page): `lane` says which one a grade
   * lives in, and every later step asks that one.
   */
  getLibraryGrades: async (): Promise<LibraryGrade[]> => {
    const [k5, g612] = await Promise.allSettled([api.get('/curriculum/grades'), api.get('/lp612/grades')]);
    const grades: LibraryGrade[] = [];
    if (k5.status === 'fulfilled') for (const g of k5.value.data.grades || []) grades.push({ grade: Number(g.grade), lane: 'k5' });
    if (g612.status === 'fulfilled') for (const g of g612.value.data.grades || []) grades.push({ grade: Number(g.grade), lane: 'g612' });
    if (!grades.length) throw new Error('no grades');
    return grades.sort((a, b) => a.grade - b.grade);
  },

  getLibrarySubjects: async (grade: number, lane: LibraryLane): Promise<LibraryOption[]> => {
    const { data } = lane === 'g612'
      ? await api.get('/lp612/subjects', { params: { grade } })
      : await api.get('/curriculum/subjects', { params: { grade } });
    return (data.subjects || []).map((s: Record<string, unknown>) => ({
      // 6-12 has no subject_key — its display name IS the key it wants back.
      key: String(s.subject_key ?? s.subject),
      label: String(s.subject),
    }));
  },

  getLibraryChapters: async (grade: number, lane: LibraryLane, subject: string): Promise<LibraryOption[]> => {
    const { data } = lane === 'g612'
      ? await api.get('/lp612/chapters', { params: { grade, subject } })
      : await api.get('/curriculum/chapters', { params: { grade, subject } });
    return (data.chapters || []).map((c: Record<string, unknown>) => {
      const n = c.chapter_number != null ? `Chapter ${c.chapter_number}` : 'Chapter';
      return {
        // K-5 addresses a chapter by number; 6-12 by chapter_key.
        key: String(c.chapter_key ?? c.chapter_number),
        label: c.chapter_title ? `${n}: ${c.chapter_title}` : n,
      };
    });
  },

  getLibraryLessons: async (grade: number, lane: LibraryLane, subject: string, chapter: string): Promise<LibraryLesson[]> => {
    if (lane === 'g612') {
      const { data } = await api.get('/lp612/lessons', {
        params: { grade, subject, chapter_key: chapter, lang: 'en' },
      });
      return (data.lessons || []).map((l: Record<string, unknown>) => ({
        id: String(l.segment_id),
        label: String(l.title ?? ''),
        sub: (l.pages_label as string) || null,
        ready: l.ready === true,
        used: false,
      }));
    }
    const { data } = await api.get('/curriculum/lps', { params: { grade, subject, chapter_number: chapter } });
    return (data.lessons || []).map((l: Record<string, unknown>) => ({
      id: String(l.lesson_id),
      label: String(l.topic || l.section || `Lesson ${l.segment_index}`),
      sub: [l.day_label, l.pages_label].filter(Boolean).join(' · ') || null,
      ready: true,
      used: l.downloaded === true,
    }));
  },

  /** Ask for a 6-12 lesson to be written (the Curriculum page's request). */
  requestLibraryLesson: async (segmentId: string): Promise<{ state: string; renderId: string }> => {
    const { data } = await api.post('/lp612/request', { segment_id: segmentId, lang: 'en' });
    return data;
  },

  getLibraryLessonStatus: async (renderId: string): Promise<{ state: string }> => {
    const { data } = await api.get(`/lp612/status/${renderId}`);
    return data;
  },

  /**
   * bd-5rz1v — her lessons still in the pipeline, OLDEST first: what the
   * Coaching list shows above the finished ones, and what its "needs your
   * answer" banner walks through.
   */
  getActiveCoachingSessions: async (): Promise<{ sessions: ActiveCoachingSession[] }> => {
    const response = await api.get('/coaching-sessions/active');
    return response.data;
  },

  getCoachingProgress: async (id: string): Promise<CoachingProgress> => {
    const response = await api.get(`/coaching-session/${id}/progress`);
    return response.data;
  },

  submitCoachingReflection: async (id: string, answer: string): Promise<{
    done?: boolean; acknowledgement?: string | null; reportStatus?: string;
  }> => {
    const response = await api.post(`/coaching-session/${id}/reflection`, { answer });
    return response.data;
  },

  /** The teacher's own Analytics page — the principal's single-teacher view, for her. */
  getMyAnalytics: async (range: { from?: string | null; to?: string | null } = {}): Promise<MyAnalyticsResponse> => {
    const params: Record<string, string> = {};
    if (range.from) params.from = range.from;
    if (range.to) params.to = range.to;
    const response = await api.get('/my-analytics', { params: Object.keys(params).length ? params : undefined });
    return response.data;
  },

  /** The Attendance page, for a teacher: her classes and her own days. */
  getMyAttendance: async (params: { from?: string | null; to?: string | null } = {}): Promise<AttendanceResponse> => {
    const query: Record<string, string> = {};
    if (params.from) query.from = params.from;
    if (params.to) query.to = params.to;
    const response = await api.get('/my-attendance', { params: query });
    return response.data;
  },
  
  getReadingAssessments: async (
    page = 1, 
    limit = 20,
    language?: string,
    gradeLevel?: number,
    passageType?: string
  ): Promise<{
    assessments: ReadingAssessment[];
    stats: ReadingStats;
    pagination: Pagination;
  }> => {
    const response = await api.get('/reading-assessments', {
      params: { page, limit, language, gradeLevel, passageType }
    });
    return response.data;
  },
  
  getReadingAssessment: async (id: string): Promise<{
    assessment: ReadingAssessmentDetail;
  }> => {
    const response = await api.get(`/reading-assessment/${id}`);
    return response.data;
  },

  // Issue #7: Video Library endpoints
  getVideos: async (page = 1, limit = 20): Promise<{
    videos: VideoRequest[];
    pagination: Pagination;
  }> => {
    const response = await api.get('/videos', {
      params: { page, limit }
    });
    return response.data;
  },

  getVideo: async (id: string): Promise<{
    video: VideoDetail;
  }> => {
    const response = await api.get(`/video/${id}`);
    return response.data;
  },

  // bd-2460 — what this deployment currently offers. Fail-closed on the server,
  // and fail-closed here too: if the call fails we assume the feature is off
  // rather than rendering a form that would 503 on submit.
  getConfig: async (): Promise<PortalConfig> => {
    try {
      const response = await api.get('/config');
      return response.data;
    } catch {
      return {
        success: true,
        features: {
          assessmentGenerator: false,
          assessmentGeneratorMessage:
            "The assessment generator is being prepared for you. We'll notify you when it's live.",
          selfObservation: false,
          coachObservation: false,
          newUi: false,
          assessmentEditing: false,
          coachV2: false,
          teacherV2: false,
        },
      };
    }
  },

  // ── Assessment Generator ────────────────────────────────────────────────
  //
  // These call the BOT's pipeline over the portal's internal-API client. The
  // previous pair pointed at /assessment/generate and /assessment/status/:jobId
  // on an engine that had been deleted — 404 on production, while the config
  // flag kept the tab lit.
  //
  // Nothing here holds an assessment rule. The question cap, the subject list
  // and the per-subject question types all arrive from getAssessmentOptions,
  // so the form cannot offer something the generator will refuse.

  /** Everything the form needs to draw itself. */
  getAssessmentOptions: async (
    grade?: number,
    subject?: string
  ): Promise<AssessmentOptions> => {
    const response = await api.get('/assessment/options', {
      params: { grade, subject },
    });
    return response.data;
  },

  /** The chapters of one book — full titles, and the pages each covers. */
  getAssessmentChapters: async (
    grade: number,
    subject: string
  ): Promise<{ success: boolean; chapters: AssessmentChapter[] }> => {
    const response = await api.get('/assessment/chapters', { params: { grade, subject } });
    return response.data;
  },

  /** Ask for a paper. 202 + a requestId to poll on; the paper does not exist yet. */
  generateAssessment: async (
    spec: AssessmentSpec
  ): Promise<{ success: boolean; requestId?: string; error?: string }> => {
    const response = await api.post('/assessment/generate', spec);
    return response.data;
  },

  /**
   * Where a request has got to.
   *
   * `queued` and `generating` are ordinary answers, not errors — the page draws
   * a spinner for them and an apology only for `failed`, which carries the code
   * saying which real thing went wrong.
   */
  getAssessmentStatus: async (requestId: string): Promise<AssessmentStatus> => {
    const response = await api.get(`/assessment/status/${requestId}`);
    return response.data;
  },

  /**
   * A time-limited link, or `available: false`.
   *
   * Not-available covers four situations the page treats identically: not hers,
   * gone, not finished, or an answer key whose location was never recorded
   * (any paper made before we started storing it).
   */
  getAssessmentDownload: async (
    paperId: string,
    artifact: 'paper' | 'answer_key' = 'paper'
  ): Promise<{ success: boolean; available: boolean; url?: string; filename?: string }> => {
    const response = await api.get(`/assessment/paper/${paperId}/download`, {
      params: { artifact },
    });
    return response.data;
  },

  /** Her finished papers, newest first, filterable by class and subject. */
  getAssessmentPapers: async (
    params: { page?: number; page_size?: number; grade?: number; subject?: string } = {}
  ): Promise<AssessmentPaperList> => {
    const response = await api.get('/assessment/papers', { params });
    return response.data;
  },

  // ── bd-hb8qs: edit a finished paper (saves a NEW version; the bot owns every rule) ──
  getAssessmentVersions: async (paperId: string): Promise<{ versions: EditVersion[] }> => {
    const response = await api.get(`/assessment/edit/${encodeURIComponent(paperId)}/versions`);
    return response.data;
  },

  getAssessmentEditQuestions: async (
    paperId: string
  ): Promise<{ paper: EditPaper; items: EditItem[] }> => {
    const response = await api.get(`/assessment/edit/${encodeURIComponent(paperId)}/questions`);
    return response.data;
  },

  getAssessmentAddKinds: async (paperId: string): Promise<{ kinds: AddKind[]; slotCap: number }> => {
    const response = await api.get(`/assessment/edit/${encodeURIComponent(paperId)}/add-kinds`);
    return response.data;
  },

  /** Throws an axios error on 400; `error.response.data.error` is the message. */
  validateAssessmentEdit: async (
    paperId: string,
    body: { id?: string; kind?: string; edit: Record<string, unknown> }
  ): Promise<{ ok: true; marks: number; text: string }> => {
    const response = await api.post(`/assessment/edit/${encodeURIComponent(paperId)}/validate`, body);
    return response.data;
  },

  saveAssessmentVersion: async (
    paperId: string,
    changes: EditChanges
  ): Promise<{ status: 'ready'; paperId: string; version: number; questionCount: number; marks: number }> => {
    const response = await api.post(
      `/assessment/edit/${encodeURIComponent(paperId)}/save`,
      { changes },
      { timeout: 60000 }
    );
    return response.data;
  },
};

// ── Portal config ─────────────────────────────────────────────────────────
// ── bd-5rz1v: a lesson still in the pipeline (GET /coaching-sessions/active) ─
export type ActiveCoachingSession = {
  id: string;
  createdAt: string;
  status?: string;
  stage: CoachingProgress['stage'];
  source: 'portal' | 'whatsapp';
  /** A portal lesson whose reflective question is waiting for her answer here. */
  needsAnswer: boolean;
  topic?: string | null;
  subject?: string | null;
};

// ── bd-5rz1v: the lesson-plan library, for "Record your class" ─────────────
export type RecentLessonPlan = {
  assetId: string;
  lessonId: string;
  topic: string | null;
  grade: string | number | null;
  subject: string | null;
  chapterNumber: number | null;
  dayLabel: string | null;
  pagesLabel: string | null;
  downloadedAt: string | null;
};
export type LibraryLane = 'k5' | 'g612';
export type LibraryGrade = { grade: number; lane: LibraryLane };
export type LibraryOption = { key: string; label: string };
/** `ready` is false only for a 6-12 lesson not written yet; `used` = she downloaded it. */
export type LibraryLesson = { id: string; label: string; sub: string | null; ready: boolean; used: boolean };

export type PortalConfig = {
  success: boolean;
  features: {
    assessmentGenerator: boolean;
    assessmentGeneratorMessage: string | null;
    /** bd-3bvfj — "Analyse a lesson" is on for THIS user (fail-closed). */
    selfObservation?: boolean;
    /** bd-5rz1v.6 — a coach can run an /observe observation from the portal (fail-closed). */
    coachObservation?: boolean;
    /** bd-5rz1v.12 — the new UI (Direction B) is on for THIS user (fail-closed). */
    newUi?: boolean;
    /** bd-hb8qs — she can edit a finished paper into a new version (fail-closed). */
    assessmentEditing?: boolean;
    /** bd-o15qnr — the coach app v2 is on for THIS user (fail-closed; shown to role=coach only). */
    coachV2?: boolean;
    /** bd-fmf24g.1 — the teacher app v2 is on for THIS user (fail-closed; shown to teachers only). */
    teacherV2?: boolean;
  };
};

// ── bd-5rz1v.6: a coach's /observe observation, run from the portal ────────

/** Where an observation stands — the bot's portal-observe-step, verbatim. */
export type ObserveStep =
  | 'analysing' | 'draft' | 'talk' | 'listening' | 'feedback' | 'report'
  | 'sending' | 'waiting_teacher' | 'sent' | 'done' | 'stopped';

export type ObserveProblem = 'too_short' | 'failed' | 'feedback_failed' | 'duplicate' | 'send_failed' | null;

export type CoachObservationSummary = {
  id: string;
  createdAt: string | null;
  teacherName: string | null;
  step: ObserveStep;
  problem: ObserveProblem;
};

export type TalkGuideSection = { title: string; body?: string; say_this?: string };
export type TalkGuide = {
  intro?: string;
  outro?: string;
  reflection_question?: string;
  sections?: { strengths?: TalkGuideSection; growth?: TalkGuideSection; action?: TalkGuideSection };
  steps?: TalkGuideSection[];
};

export type CoachFeedback = {
  harmful: boolean;
  praise_line: string | null;
  wins: { behaviour: string; evidence: string }[];
  try: { move: string; evidence: string; instead: string | null } | null;
  reflection_question: string | null;
  concern: { what_happened: string; why_it_matters: string; instead: string } | null;
};

export type CoachObservationView = {
  id: string;
  createdAt: string | null;
  sessionStatus: string;
  step: ObserveStep;
  problem: ObserveProblem;
  preparing: boolean;
  /** bd-15y1pc — false: captured on WhatsApp, read here, acted on there. Absent from an older bot. */
  portal?: boolean;
  teacher: { name: string | null; phone: string | null } | null;
  lesson: { topic: string | null; subject: string | null; hasLessonPlan: boolean };
  draft: { edited: boolean };
  talk: { guide: TalkGuide | null; recordedAt: string | null; feedback: CoachFeedback | null };
  report: {
    status: string | null; teacherName: string | null; teacherPhone: string | null;
    caption: string | null; companionText: string | null; imageUrl: string | null;
    sentAt: string | null; templateSentAt: string | null;
  };
};

export type DraftOption = { id: string; title: string };
export type DraftIndicator = {
  id: string; field: string; name: string;
  rating: string | undefined; evidence: string | undefined; improvement: string | undefined;
};
export type DraftMove = { k: number; plan: string; verdict: string; evidence: string };
export type DraftSection =
  | { key: string; letter: string; title: string; kind: 'indicators'; notes: string[]; indicators: DraftIndicator[] }
  | { key: string; letter: string; title: string; kind: 'moves'; header: string; fallback: string; moves: DraftMove[] };
/** bd-15y1pc — `editable: false`: her answers, to read; the portal can no longer change them. Absent from an older bot. */
export type ObservationDraft = { scale: DraftOption[]; fidelityScale: DraftOption[]; sections: DraftSection[]; saved: boolean; editable?: boolean };

// ── Assessment Generator types ────────────────────────────────────────────
//
// These mirror what the BOT returns. Nothing here carries a default the bot
// could disagree with — notably there is no MAX_COUNT: the cap lives in
// AssessmentOptions.maxQuestions and arrives with the options.

/** A question type the generator supports for a given subject and grade. */
export type AssessmentQuestionType = {
  id: string;
  category: 'objective' | 'subjective';
};

export type AssessmentSubject = {
  subject_key: string;
  subject: string;
};

export type AssessmentChapter = {
  chapter_number: number;
  chapter_title: string;
  page_start: number | null;
  page_end: number | null;
  page_count: number | null;
};

export type AssessmentOptions = {
  success: boolean;
  grades: number[];
  subjects?: AssessmentSubject[];
  types?: AssessmentQuestionType[];
  /** The one cap. Never hardcoded here — the dead panel's 20 vs the bot's 25. */
  maxQuestions: number;
  defaultQuestions: number;
};

export type AssessmentSpec = {
  grade: number;
  subject: string;
  chapterNumber?: number | null;
  /** Every chapter the paper covers, in book order (bd-ix9uhr). One chapter also goes as chapterNumber. */
  chapterNumbers?: number[] | null;
  pageRanges?: string | null;
  contentSource?: 'seen' | 'unseen' | 'both';
  questionCount: number;
  /** Bare type ids; the bot spreads the count across them. */
  questionTypes?: string[];
  /** Ignored: every paper is made with its answer key. Kept so older callers still type-check. */
  includeAnswerKey?: boolean;
  answerLines?: boolean;
  outputFormat?: 'pdf' | 'docx';
};

export type AssessmentStatus = {
  success: boolean;
  status: 'queued' | 'generating' | 'ready' | 'failed' | 'not_found';
  paperId?: string | null;
  errorCode?: string | null;
};

export type AssessmentPaper = {
  paper_id: string;
  grade: number | null;
  subject_key: string;
  subject: string;
  chapter_number: number | null;
  question_count: number | null;
  total_marks: number | null;
  ready_at: string | null;
  /** Whether the answer-key button can be drawn at all. */
  has_answer_key: boolean;
  /** Which version of the paper this entry is (1 = as generated). One entry per paper, its latest version. */
  version?: number;
  /** How many ready versions the paper has. */
  version_count?: number;
};

export type AssessmentPaperList = {
  success: boolean;
  papers: AssessmentPaper[];
  total: number;
  page: number;
  pageSize: number;
};

// ── bd-hb8qs: edit-a-paper types ──────────────────────────────────────────
export type EditFields = {
  shape: 'options' | 'columns' | 'words' | 'comprehension' | 'passage' | 'standard';
  question: string; marks: string; answer: string; lines: string; lines_default: number | null;
  lines_options: { id: string; title: string }[]; show_lines: boolean;
  slots?: string[]; correct?: string; correct_options?: { id: string; title: string }[];
  msq?: boolean; show_correct?: boolean; show_answer_text?: boolean;
  pairs?: { left: string; right: string }[]; passage?: string;
  subs?: { index: number; text: string; marks: number | null }[];
};
export type EditItem = {
  id: string; number: number | null; removed: boolean; type: string;
  section: 'objective' | 'subjective'; marks: number; text: string; fields: EditFields;
  subs?: { index: number; fields: EditFields }[];
};
export type EditPaper = { paperId: string; version: number; grade: number; subject: string;
  chapterNumber: number | null; rtl: boolean; questionCount: number; marks: number };
export type EditVersion = { paperId: string; version: number | null; status: 'ready' | 'failed' | 'generating';
  createdAt: string; questionCount: number | null; marks: number | null; editedFrom: string | null; latest: boolean };
export type AddLayout = 'standard' | 'options' | 'columns' | 'words' | 'comprehension';
export type AddKind = {
  kind: string;            // catalogue type id, sent back as `kind`
  label: string;
  layout: AddLayout;
  section: 'objective' | 'subjective';
  marks: number; lines: number;
  msq?: boolean;           // several correct
  presetOptions?: string[]; // True/False: ['True','False']
};
export type EditChanges = {
  edits?: { id: string; edit: Record<string, unknown> }[];
  removed?: string[]; restored?: string[];
  added?: { kind: string; edit: Record<string, unknown> }[];
};
export type EditError = { id?: string; subIndex?: number; addedIndex?: number; message: string };

// Leader Portal endpoints (bd-2434) — school-leader family only.
// The backend gate 403s non-leaders; the frontend also hides these via isLeader.
export const leader = {
  getOverview: async (): Promise<{ success: boolean; overview: LeaderOverview }> => {
    const response = await api.get('/leader/overview');
    return response.data;
  },

  getTeachers: async (): Promise<{ success: boolean; total: number; onRumi: number; teachers: LeaderPatchTeacher[] }> => {
    const response = await api.get('/leader/teachers');
    return response.data;
  },

  getTeacher: async (id: string): Promise<{ success: boolean } & LeaderTeacherDetail> => {
    const response = await api.get(`/leader/teacher/${id}`);
    return response.data;
  },

  // bd-60117 — a principal's SCHOOL analytics. 403s for the rest of the leader
  // family: they are multi-school, so a single school's numbers would be a
  // confident wrong answer rather than a missing one.
  // bd-60118 — teacherId narrows every STEPS component to one teacher. The
  // server validates it against her school and 404s otherwise, so this is a
  // convenience, not the boundary.
  getSchoolAnalytics: async (
    teacherId?: string | null,
    range: { from?: string | null; to?: string | null } = {},
  ): Promise<SchoolAnalyticsResponse> => {
    const params: Record<string, string> = {};
    if (teacherId) params.teacherId = teacherId;
    if (range.from) params.from = range.from;
    if (range.to) params.to = range.to;
    const response = await api.get('/leader/school-analytics', {
      params: Object.keys(params).length ? params : undefined,
    });
    return response.data;
  },

  // bd-60123 — attendance, merged per group (G3) and split per day. Window
  // defaults to the last 30 days server-side.
  getAttendance: async (params: { from?: string | null; to?: string | null; teacherId?: string | null } = {}):
    Promise<AttendanceResponse> => {
    const query: Record<string, string> = {};
    if (params.from) query.from = params.from;
    if (params.to) query.to = params.to;
    if (params.teacherId) query.teacherId = params.teacherId;
    const response = await api.get('/leader/attendance', { params: query });
    return response.data;
  },

  // bd-2455 — upcoming schedules + pending debriefs + completed observations.
  getObservations: async (): Promise<{ success: boolean; observations: LeaderObservationsData }> => {
    const response = await api.get('/leader/observations');
    return response.data;
  },

  // bd-2676 — book a visit from the portal (Riffat R33: clearing WhatsApp
  // storage used to lose the schedule). Create + cancel only, no edit.
  createSchedule: async (input: { teacherExtId: string; date: string; slot?: string }):
    Promise<{ success: boolean; id?: string; updated?: boolean }> => {
    const response = await api.post('/leader/schedules', input);
    return response.data;
  },

  cancelSchedule: async (id: string): Promise<{ success: boolean; cancelled?: boolean }> => {
    const response = await api.post(`/leader/schedules/${id}/cancel`);
    return response.data;
  },

  // ── bd-5rz1v.6: an /observe observation, run from the portal ─────────────

  /** Sign a direct-to-R2 upload (signed under the coach's own id). */
  presignObserveUpload: async (args: {
    filename: string; sizeBytes: number; kind: 'audio' | 'lesson_plan' | 'photo';
  }): Promise<{ key: string; uploadUrl: string; contentType: string }> => {
    const response = await api.post('/leader/observe-upload/presign', args);
    return response.data;
  },

  /** Start the observation of one teacher in her patch. A refusal rejects with err.response. */
  startObservation: async (args: {
    teacherExtId: string; schoolExtId?: string | null; key: string; lessonPlanKey?: string; photoKeys: string[];
    lessonPlan?: { assetId: string } | { lessonId: string } | { segmentId: string; lang: 'en' | 'ur' };
  }): Promise<{ coachingSessionId: string }> => {
    const response = await api.post('/leader/observe/start', args);
    return response.data;
  },

  /** HER recent plans — the teacher being observed. */
  getObserveRecentPlans: async (teacherExtId: string, schoolExtId?: string | null): Promise<{ plans: RecentLessonPlan[] }> => {
    const response = await api.get('/leader/observe/recent-plans', {
      params: schoolExtId ? { teacherExtId, schoolExtId } : { teacherExtId },
    });
    return response.data;
  },

  getActiveObservations: async (): Promise<{ observations: CoachObservationSummary[] }> => {
    const response = await api.get('/leader/observe/active');
    return response.data;
  },

  getObservation: async (id: string): Promise<CoachObservationView> => {
    const response = await api.get(`/leader/observe/${id}`);
    return response.data;
  },

  getObservationDraft: async (id: string): Promise<ObservationDraft> => {
    const response = await api.get(`/leader/observe/${id}/draft`);
    return response.data;
  },

  /** The review form's own keys: r_/ev_/imp_ per indicator, fid_r_/fid_e_ per lesson-plan move. */
  saveObservationDraft: async (id: string, edits: Record<string, string>): Promise<{ success: boolean }> => {
    const response = await api.post(`/leader/observe/${id}/draft`, { edits });
    return response.data;
  },

  /** The guide for her talk with the teacher (the first open can take a minute). */
  getTalkGuide: async (id: string): Promise<{ guide: TalkGuide | null }> => {
    const response = await api.post(`/leader/observe/${id}/talk/guide`, {}, { timeout: 120_000 });
    return response.data;
  },

  startTalk: async (id: string, key: string): Promise<{ success: boolean }> => {
    const response = await api.post(`/leader/observe/${id}/talk`, { key });
    return response.data;
  },

  retryTalk: async (id: string): Promise<{ success: boolean }> => {
    const response = await api.post(`/leader/observe/${id}/talk/retry`);
    return response.data;
  },

  previewReport: async (id: string): Promise<{ success: boolean }> => {
    const response = await api.post(`/leader/observe/${id}/report/preview`);
    return response.data;
  },

  sendReport: async (id: string): Promise<{ success: boolean }> => {
    const response = await api.post(`/leader/observe/${id}/report/send`);
    return response.data;
  },
};

// Classes — the teacher's own classes (teacher-owned only; a principal's or
// coach's view of a school's classes is deliberately not here yet).
//
// The backend proxies these to the bot, so the grade/subject labels below are
// already resolved for this teacher's language. The page renders them as given
// rather than keeping its own copy of the vocabulary.
// ── bd-o15qnr: the coach app v2 (behind portal_coach_v2) ─────────────────
// Every call sends the coach's own day (?today=); the server uses it only when
// it is within a day of its own UTC date (Pakistan is UTC+5).
const coachDay = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

export const coach = {
  getHome: async (): Promise<{ success: boolean; home: CoachHomeData }> => {
    const response = await api.get('/coach/home', { params: { today: coachDay() } });
    return response.data;
  },
  getSchedule: async (range: { from?: string; to?: string } = {}): Promise<{ success: boolean } & CoachScheduleData> => {
    const response = await api.get('/coach/schedule', { params: { ...range, today: coachDay() } });
    return response.data;
  },
  getTeam: async (args: { date?: string; coach?: string } = {}): Promise<{ success: boolean } & TeamData> => {
    const params: Record<string, string> = { today: coachDay() };
    if (args.date) params.date = args.date;
    if (args.coach) params.coach = args.coach;
    const response = await api.get('/coach/team', { params });
    return response.data;
  },
  getPeople: async (): Promise<{ success: boolean } & PeopleData> => {
    const response = await api.get('/coach/people', { params: { today: coachDay() } });
    return response.data;
  },
  getSchool: async (emis: string): Promise<{ success: boolean } & SchoolData> => {
    const response = await api.get(`/coach/school/${encodeURIComponent(emis)}`, { params: { today: coachDay() } });
    return response.data;
  },
  getTeacher: async (teacherExtId: string): Promise<{ success: boolean } & TeacherData> => {
    const response = await api.get(`/coach/teacher/${encodeURIComponent(teacherExtId)}`, { params: { today: coachDay() } });
    return response.data;
  },
  /** bd-o15qnr.10 — one sent HITL report from a teacher's History. */
  getObservation: async (id: string): Promise<{ success: boolean } & ObservationReport> => {
    const response = await api.get(`/coach/observation/${encodeURIComponent(id)}`, { params: { today: coachDay() } });
    return response.data;
  },
  /** bd-o15qnr.11 — Edit teacher: saved by the /observe teacher admin (commitAdd moves her). */
  moveTeacher: async (teacherExtId: string, schoolExtId: string): Promise<{ success: boolean; outcome?: string; reason?: string }> => {
    const response = await api.post(`/coach/teacher/${encodeURIComponent(teacherExtId)}/move`, { schoolExtId });
    return response.data;
  },
  /**
   * bd-o15qnr.13 — name | level (bands[]) | role | phone_check | phone, saved by
   * main's /observe edit path (ported). A refusal arrives as an HTTP error whose
   * body carries `reason` (and, for a taken number, main's heading/message).
   */
  editTeacher: async (teacherExtId: string, edit: "name" | "level" | "role" | "phone_check" | "phone", value: unknown): Promise<{ success: boolean; outcome?: string; phone?: string; reason?: string; heading?: string; message?: string; hoursRemaining?: number }> => {
    const response = await api.post(`/coach/teacher/${encodeURIComponent(teacherExtId)}/edit`, { edit, value });
    return response.data;
  },
  /** bd-o15qnr.11 — Remove from school: the /observe teacher admin's commitRemovals. */
  removeTeacher: async (teacherExtId: string): Promise<{ success: boolean; reason?: string }> => {
    const response = await api.post(`/coach/teacher/${encodeURIComponent(teacherExtId)}/remove`, {});
    return response.data;
  },
  getVisit: async (id: string): Promise<{ success: boolean } & VisitData> => {
    const response = await api.get(`/coach/visit/${encodeURIComponent(id)}`, { params: { today: coachDay() } });
    return response.data;
  },
  /** bd-o15qnr.21 — what waits on her (Feedback Form, Debrief): the pending banner. */
  getPending: async (): Promise<{ success: boolean; waiting: number; ids: string[] }> => {
    const response = await api.get('/coach/pending');
    return response.data;
  },
  getReports: async (args: { page?: number; q?: string } = {}): Promise<{ success: boolean } & ReportsData> => {
    const params: Record<string, string> = {};
    if (args.page) params.page = String(args.page);
    if (args.q) params.q = args.q;
    const response = await api.get('/coach/reports', { params });
    return response.data;
  },
  /** Reschedule — the existing edit route (bd-88krt); same time rule as booking. */
  editSchedule: async (id: string, input: { date: string; slot: string }): Promise<{ success: boolean; id?: string }> => {
    const response = await api.post(`/leader/schedules/${encodeURIComponent(id)}/edit`, input);
    return response.data;
  },
};

export const classes = {
  list: async (): Promise<ClassesResponse> => {
    const response = await api.get('/classes');
    return response.data;
  },

  create: async (payload: CreateClassPayload): Promise<CreateClassResponse> => {
    const response = await api.post('/classes', payload);
    return response.data;
  },

  // The roster belongs to the CLASS — every teacher assigned to it sees and edits
  // the same children.
  students: async (classId: string): Promise<{ success: boolean; students: RosterStudent[] }> => {
    const response = await api.get(`/classes/${classId}/students`);
    return response.data;
  },

  addStudents: async (classId: string, rawText: string): Promise<AddStudentsResponse> => {
    const response = await api.post(`/classes/${classId}/students`, { rawText });
    return response.data;
  },

  removeStudent: async (classId: string, studentId: string): Promise<{ success: boolean }> => {
    const response = await api.delete(`/classes/${classId}/students/${studentId}`);
    return response.data;
  },
};

export default api;
