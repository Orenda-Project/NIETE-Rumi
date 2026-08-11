import axios from 'axios';
import { getApiBaseUrl } from '@/lib/runtime';
import type { User, DashboardStats, LessonPlan, CoachingSession, SessionDetail, CoachingAnalytics, Pagination, VideoRequest, VideoDetail, LeaderOverview, LeaderPatchTeacher, LeaderTeacherDetail, LeaderObservationsData } from '../types/portal';
import type { ReadingAssessment, ReadingAssessmentDetail, ReadingStats } from '../types/readingAssessment';

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

  // Assessment Generator (browser surface for the UG_EG-backed engine).
  // generate → { jobId }; then poll getAssessmentStatus until completed/failed.
  generateAssessment: async (
    spec: AssessmentSpec
  ): Promise<{ success: boolean; jobId?: string; error?: string }> => {
    const response = await api.post('/assessment/generate', spec);
    return response.data;
  },

  getAssessmentStatus: async (
    jobId: string,
    format: 'pdf' | 'docx' = 'pdf'
  ): Promise<AssessmentStatus> => {
    const response = await api.get(`/assessment/status/${jobId}`, { params: { format } });
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

// ── Assessment Generator types ────────────────────────────────────────────
export type AssessmentQuestionType = {
  id: string;
  count: number;
  category?: 'objective' | 'subjective';
};

export type AssessmentSpec = {
  generationType: 'exam' | 'class_assessment';
  grade: number;
  subject: string;
  pageRanges: string;
  contentSource: 'seen' | 'unseen';
  questionTypes: AssessmentQuestionType[];
  format?: 'pdf' | 'docx';
};

export type AssessmentStatus = {
  success: boolean;
  status: 'pending' | 'processing' | 'completed' | 'failed';
  downloadUrl?: string;
  filename?: string;
  error?: string;
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
  }
};

export default api;
