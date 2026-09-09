import axios from 'axios';
import { getApiBaseUrl } from '@/lib/runtime';
import type { User, DashboardStats, LessonPlan, CoachingSession, SessionDetail, CoachingAnalytics, Pagination, VideoRequest, VideoDetail, LeaderOverview, LeaderPatchTeacher, LeaderTeacherDetail, LeaderObservationsData } from '../types/portal';
import type { ReadingAssessment, ReadingAssessmentDetail, ReadingStats } from '../types/readingAssessment';
import type { ClassesResponse, CreateClassPayload, CreateClassResponse, RosterStudent, AddStudentsResponse } from '../types/portal';

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
        },
      };
    }
  },

  // ── Assessment Generator (bd-60067) ─────────────────────────────────────
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
};

// ── Portal config ─────────────────────────────────────────────────────────
export type PortalConfig = {
  success: boolean;
  features: {
    assessmentGenerator: boolean;
    assessmentGeneratorMessage: string | null;
  };
};

// ── Assessment Generator types (bd-60067) ─────────────────────────────────
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
  pageRanges?: string | null;
  contentSource?: 'seen' | 'unseen' | 'both';
  questionCount: number;
  /** Bare type ids; the bot spreads the count across them. */
  questionTypes?: string[];
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
};

export type AssessmentPaperList = {
  success: boolean;
  papers: AssessmentPaper[];
  total: number;
  page: number;
  pageSize: number;
};

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
  }
};

// Classes — the teacher's own classes (teacher-owned only; a principal's or
// coach's view of a school's classes is deliberately not here yet).
//
// The backend proxies these to the bot, so the grade/subject labels below are
// already resolved for this teacher's language. The page renders them as given
// rather than keeping its own copy of the vocabulary.
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
