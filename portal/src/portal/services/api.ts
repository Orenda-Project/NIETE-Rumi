import axios from 'axios';
import { getApiBaseUrl } from '@/lib/runtime';
import { isLinkSession, LINK_EXPIRED_PAGE } from '../lib/linkSession';
import { ANALYTICS_LOGIN } from '../lib/homeRoute';
import type { User, DashboardStats, LessonPlan, CoachingSession, SessionDetail, CoachingAnalytics, Pagination, VideoRequest, VideoDetail, LeaderOverview, LeaderPatchTeacher, LeaderTeacherDetail, LeaderObservationsData, SchoolAnalyticsResponse,
  AttendanceResponse } from '../types/portal';
import type { ChildTestVisit, ChildTestList, ChildTestCard, ChildTestSession, ChildTestBlockName } from '../types/childTest';
import type { SaBlock, SaDashboardSession, SaEarMark, SaList, SaOutcome, SaResults, SaReview, SaSchool, SaSessionStatus, SaSwitches } from '../types/childTestSa';
import type { ReadingAssessment, ReadingAssessmentDetail, ReadingStats } from '../types/readingAssessment';
import type { MyAnalyticsResponse, ClassesResponse, CreateClassPayload, CreateClassResponse, RosterStudent, AddStudentsResponse, CoachingProgress } from '../types/portal';
import type { CoachingAnalyticsResponse, SchoolsAnalyticsResponse } from '../types/portal';
import type { LpBand, LpEngagementResponse } from '../types/portal';
import type { CoachHomeData, CoachScheduleData, TeamData, PeopleData, SchoolData, TeacherData, VisitData, ReportsData, ObservationReport, SchoolHit, TeacherPlan } from '../coach/types';

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
      // A session from a template's link goes back to the link page, not a password
      // login she may never have set (lib/linkSession.ts).
      if (isLinkSession()) {
        window.location.replace(LINK_EXPIRED_PAGE);
        return Promise.reject(error);
      }
      const currentPath = window.location.pathname;
      // Don't redirect if already on login/setup pages (the analytics accounts' own sign-in is one: its signed-out
      // session read and a refused name both answer 401, and neither may send her to the teacher sign-in).
      if (!currentPath.includes('/portal/login') && 
          !currentPath.includes(ANALYTICS_LOGIN) &&
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
  },

  // An old /portal/setup/<token> link signs her in (the token is spent); a dead one answers 400 LINK_EXPIRED.
  setupSignIn: async (token: string) => {
    const response = await api.post('/setup-sign-in', { token });
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


/** bd-v0toag.31: the live moves record sent with a recording (stored as analysis_data.live_moves). */
export type LiveMovesTap = { idx: number; choice: 'did' | 'did_not'; at: string; live_state: 'ticked' | 'unticked' };
export type LiveMovesRecord = {
  lessonId: string; stamp: string | null; liveId: string;
  moves: { idx: number; covers: string[]; tickedAtMs: number | null }[];
  taps: LiveMovesTap[]; drops: number; bytesSent: number;
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

  /** Sign a direct-to-R2 upload for one file. reflection_audio (bd-eygg2f): her spoken answer to the question. */
  presignCoachingUpload: async (args: {
    filename: string; sizeBytes: number; kind: 'audio' | 'lesson_plan' | 'photo' | 'reflection_audio';
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
    // bd-1d6g8o: told apart in the failure report (an upload the phone cut off is not the network).
    xhr.onabort = () => reject(new Error('upload failed (abort)'));
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
    /** bd-v0toag.31: what the live screen saw while she recorded; the bot validates it. */
    liveMoves?: LiveMovesRecord;
    /** bd-bmc9a0.2: "Save recording" (ICT IAB row 31) — the same start, marked saved to come back to. */
    saveForLater?: boolean;
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

  // ── bd-v0toag.31: live moves while she records (group D only; the bot decides) ──

  liveEligible: async (): Promise<{ on: boolean }> => (await api.post('/coaching-live/eligible', {})).data,
  liveCard: async (lessonId: string): Promise<{ on: boolean; card?: LiveCard }> => (
    (await api.post('/coaching-live/card', { lessonId })).data
  ),
  liveKey: async (liveId: string): Promise<LiveKey> => (await api.post('/coaching-live/key', { liveId })).data,
  liveDetect: async (body: {
    liveId: string; lessonId: string; window: string; unticked: number[];
  }): Promise<{ ticked: number[] }> => (await api.post('/coaching-live/detect', body)).data,
  liveEnd: async (body: { liveId: string; drops: number; bytesSent: number }): Promise<{ ok: boolean }> => (
    (await api.post('/coaching-live/end', body)).data
  ),
  liveTaps: async (body: { coachingSessionId: string; taps: LiveTap[] }): Promise<{ ok: boolean; reason?: string }> => (
    (await api.post('/coaching-live/taps', body)).data
  ),

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

  /** bd-aqotzx — her answer when the recording did not sound like a class: yes carries on, no closes it. */
  answerClassCheck: async (id: string, answer: 'yes' | 'no'): Promise<{ next?: 'analysis' | 'record_again' }> => {
    const response = await api.post(`/coaching-session/${id}/class-check`, { answer });
    return response.data;
  },

  submitCoachingReflection: async (id: string, answer: string): Promise<{
    done?: boolean; acknowledgement?: string | null; acknowledgementAudioUrl?: string; reportStatus?: string;
  }> => {
    const response = await api.post(`/coaching-session/${id}/reflection`, { answer });
    return response.data;
  },

  /**
   * bd-eygg2f — her spoken answer, already in R2 (presign kind reflection_audio). The bot transcribes it before
   * it acknowledges, so this waits longer than a typed answer (the dashboard gives the bot 90 s).
   */
  /**
   * bd-oawrlt — her report image, signed NOW (Download: attachment, Open: inline). A link signed when the page loaded
   * expires after an hour; this is asked for at tap time. null when there is no report.
   */
  getCoachingReportFile: async (id: string, disposition: 'attachment' | 'inline'): Promise<string | null> => {
    const response = await api.get(`/coaching-session/${id}/report-file`, { params: { disposition } });
    return response.data?.url || null;
  },

  submitCoachingVoiceReflection: async (id: string, audioKey: string): Promise<{
    done?: boolean; acknowledgement?: string | null; acknowledgementAudioUrl?: string; reportStatus?: string;
  }> => {
    const response = await api.post(`/coaching-session/${id}/reflection`, { audioKey }, { timeout: 120_000 });
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
          childTest: false,
          childTestSa: false,
          coachObservation: false,
          newUi: false,
          assessmentEditing: false,
          coachV2: false,
          coachDisagreements: false,
          teacherV2: false,
          coachip: false,
          coachipRm: false,
          coachipDecode: false,
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

  /** One chapter's topics for the topic picker — names and headings only, never SLO codes. [] when none loaded. */
  getAssessmentTopics: async (
    grade: number,
    subject: string,
    chapter: number
  ): Promise<{ success: boolean; topics: AssessmentTopic[] }> => {
    const response = await api.get('/assessment/topics', { params: { grade, subject, chapter } });
    return response.data;
  },

  /** Ask for a paper. 202 + a requestId to poll on; the paper does not exist yet. */
  generateAssessment: async (
    spec: AssessmentSpec
  ): Promise<{ success: boolean; requestId?: string; error?: string }> => {
    lastGenerateFailure = null;
    try {
      const response = await api.post('/assessment/generate', spec);
      return response.data;
    } catch (e) {
      // The refusal's code (PATTERN_OFF, ALREADY_GENERATING, RATE_LIMITED …) for the screen that asked; the error
      // itself goes on unchanged, so every caller that reads `response.data.error` behaves as before.
      lastGenerateFailure = generateFailureOf(e);
      throw e;
    }
  },

  /** The code of the last refused generateAssessment, read once (the job tracker keeps only the message). */
  takeGenerateFailure: (): GenerateFailure | null => {
    const f = lastGenerateFailure;
    lastGenerateFailure = null;
    return f;
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
  getAssessmentVersions: async (paperId: string): Promise<{ versions: EditVersion[]; pattern?: string | null }> => {
    const response = await api.get(`/assessment/edit/${encodeURIComponent(paperId)}/versions`);
    return response.data;
  },

  /** bd-fmf24g.31: the paper's own questions (hers only; not behind the editing switch). */
  getAssessmentPaperView: async (paperId: string): Promise<PaperView> => {
    const response = await api.get(`/assessment/paper/${encodeURIComponent(paperId)}/view`);
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
  /** bd-aqotzx — set on a stopped row kept in the list (a recording that did not sound like a class). */
  stopReason?: string | null;
};

// ── bd-5rz1v: the lesson-plan library, for "Record your class" ─────────────
// ── bd-v0toag.31: live moves ──
export interface LiveMove { idx: number; covers: string[]; chip: string; do: string; say: string }
export interface LiveCard { lessonId: string; stamp: string; sections: { sec: string; minutes: number; moves: LiveMove[] }[] }
export type LiveKey =
  | { ok: true; api_key: string; expires_at: string; ws: string; model: string }
  | { ok: false; reason: 'off' | 'cap' | 'mint' };
export interface LiveTap { idx: number; choice: 'did' | 'did_not'; at: string; live_state: 'ticked' | 'unticked' }

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
  /** This tier's WhatsApp bot number (digits), or null when the server has none configured: show no chat button. */
  bot?: string | null;
  features: {
    assessmentGenerator: boolean;
    assessmentGeneratorMessage: string | null;
    /** bd-3bvfj — "Analyse a lesson" is on for THIS user (fail-closed). */
    selfObservation?: boolean;
    /** bd-s1oo0.7 — the child test in the coach app is on for THIS user (fail-closed). */
    childTest?: boolean;
    /** The coach's Learning assessment (child test on the SA engine) is on for THIS user (fail-closed). */
    childTestSa?: boolean;
    /** bd-5rz1v.6 — a coach can run an /observe observation from the portal (fail-closed). */
    coachObservation?: boolean;
    /** bd-5rz1v.12 — the new UI (Direction B) is on for THIS user (fail-closed). */
    newUi?: boolean;
    /** bd-hb8qs — she can edit a finished paper into a new version (fail-closed). */
    assessmentEditing?: boolean;
    /** bd-o15qnr — the coach app v2 is on for THIS user (fail-closed; shown to role=coach only). */
    coachV2?: boolean;
    /** bd-tbprit.1 — the coach's disagreement card is on for THIS user (fail-closed). */
    coachDisagreements?: boolean;
    /** bd-fmf24g.1 — the teacher app v2 is on for THIS user (fail-closed; shown to teachers only). */
    teacherV2?: boolean;
    /** The teacher Home card, its score chips and tap log (portal_teacher_home_card; fail-closed). */
    teacherHomeCard?: boolean;
    /** The teacher sign-in takes a non-PK number with its country code (portal_login_intl_numbers; one switch, fail-closed). */
    loginIntlNumbers?: boolean;
    /** The per-teacher Home tile order (portal_teacher_home_order; read only with the card's switch). */
    teacherHomeOrder?: boolean;
    /** The teacher Home's new look (portal_teacher_home_look; read only with the card's switch; fail-closed). */
    teacherHomeLook?: boolean;
    /** COACHIP, the coach insight portal (portal_coachip, per user; fail-closed). bd-sex15q.13 */
    coachip?: boolean;
    /** COACHIP for an RM: this user has a sector in portal_coachip_rm (an object; fail-closed). bd-sex15q.13 */
    coachipRm?: boolean;
    /** COACHIP's "Show name" tap (portal_coachip_decode, and only with coachip on; fail-closed). bd-sex15q.13 */
    coachipDecode?: boolean;
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
  /** bd-fmf24g.66 — what became of the plan attached: her own file (reading / read / unreadable), a library plan, or none. Absent from an older bot. */
  lessonPlan?: { source: 'own' | 'library' | 'none'; format: string | null; state: 'reading' | 'read' | 'unreadable' | null; topic: string | null };
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

/** A refused POST /assessment/generate: the server's code, the HTTP status, and for 429 when to try again. */
export type GenerateFailure = { errorCode: string; status: number | null; retryAt: string | null; requestId: string | null };

let lastGenerateFailure: GenerateFailure | null = null;

/** The code inside an axios error from /assessment/generate, or null when the server gave none. */
export function generateFailureOf(e: unknown): GenerateFailure | null {
  const r = (e as { response?: { status?: number; data?: { errorCode?: unknown; retryAt?: unknown; requestId?: unknown } } })?.response;
  const code = r?.data?.errorCode;
  if (typeof code !== 'string' || !code) return null;
  return {
    errorCode: code,
    status: typeof r?.status === 'number' ? r.status : null,
    retryAt: typeof r?.data?.retryAt === 'string' ? r.data.retryAt : null,
    requestId: typeof r?.data?.requestId === 'string' ? r.data.requestId : null,
  };
}
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

/** A topic of one chapter (assessment_topics). `heading` groups topics on screen; sortOrder is book order. */
export type AssessmentTopic = {
  topicId: string;
  name: string;
  heading: string | null;
  headingOrder: number | null;
  sortOrder: number;
};

export type AssessmentOptions = {
  success: boolean;
  grades: number[];
  subjects?: AssessmentSubject[];
  types?: AssessmentQuestionType[];
  /** The one cap. Never hardcoded here — the dead panel's 20 vs the bot's 25. */
  maxQuestions: number;
  defaultQuestions: number;
  /** Only while the board pattern is on: the grades it serves (any call), and the pattern for this grade + subject. */
  patternGrades?: number[];
  patterns?: AssessmentPattern[];
};

/** EN + UR, as /assessment/options sends a board pattern's lines (data from the pattern module, never typed here). */
export type BiText = { en: string; ur: string };

/** A board pattern for one grade + subject: what the teacher is shown before Make (api.md §1). */
export type AssessmentPattern = {
  id: string;
  name: BiText;
  holds: BiText;
  sections: Array<{ id: string } & BiText>;
  choice: BiText | null;
  choices?: Array<{ slot: string; label_en: string; label_ur: string; generate: number; attempt: number; marks_each: number }>;
  youAdd: (BiText & { kind?: string; slot?: string }) | null;
  files: BiText;
  scope: BiText & {
    label: BiText;
    chapters: number[];
    displayChapters?: number[];
    excluded: number[];
    topicsOnly: number[];
    held: number[];
    unitRanges: Array<{ chapter: number; ranges: string }>;
  };
  generateTotal: number;
  totalMarks: number;
  totalTime: BiText;
  waitHint: BiText;
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
  /** A board-pattern request (absent on every other paper). */
  pattern?: string;
  scope?: 'fde';
};

export type AssessmentStatus = {
  success: boolean;
  status: 'queued' | 'generating' | 'ready' | 'failed' | 'not_found';
  paperId?: string | null;
  errorCode?: string | null;
  /** The board pattern the request was made with (api.md §4.5, R5-16); null/absent for a plain request or an older server. */
  pattern?: string | null;
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
  /** The board pattern the paper was made in (null / absent: a plain paper), and its two files' page counts. */
  pattern?: string | null;
  pages?: { paper: number | null; scheme: number | null } | null;
};

export type AssessmentPaperList = {
  success: boolean;
  papers: AssessmentPaper[];
  total: number;
  page: number;
  pageSize: number;
};

// ── bd-fmf24g.31: a paper's questions, as the paper page reads them ──
export type PaperSub = { letter: string; text: string; marks: number | null; options: string[] };
export type PaperQuestion = {
  number: number; text: string; marks: number | null;
  shape: 'options' | 'columns' | 'words' | 'comprehension' | 'passage' | 'standard';
  options?: string[]; pairs?: { left: string; right: string }[]; words?: string[]; passage?: string; subs?: PaperSub[];
};
export type PaperSection = { heading: string | null; lead: string | null; questions: PaperQuestion[] };
export type PaperView = {
  success: boolean;
  paper: {
    paperId: string; version: number | null; grade: number | null; subject: string; chapterNumber: number | null; rtl: boolean; questionCount: number; marks: number;
    /** A board-pattern paper: the pattern, its page counts, and what the teacher adds (with the page it goes on). */
    pattern?: string | null; totalMarks?: number | null; pages?: { paper: number | null; scheme: number | null } | null;
    youAdd?: (BiText & { page: number | null }) | null;
  };
  sections: PaperSection[];
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
  meanings?: boolean;      // Word Meanings: a meaning beside each word
};
export type EditChanges = {
  edits?: { id: string; edit: Record<string, unknown> }[];
  removed?: string[]; restored?: string[];
  added?: { kind: string; edit: Record<string, unknown> }[];
};
export type EditError = { id?: string; subIndex?: number; addedIndex?: number; message: string };

// bd-s6qbts.3 — the schools analytics page, for analytics-only accounts (the server 403s everyone else).
// `from`/`to` are inclusive days (YYYY-MM-DD); null leaves that end open. `region` is one of the six sector
// names or 'all' (null = all).
export const analytics = {
  getSchools: async (q: { from: string | null; to: string | null; region: string | null }): Promise<SchoolsAnalyticsResponse> => {
    const params: Record<string, string> = {};
    if (q.from) params.from = q.from;
    if (q.to) params.to = q.to;
    params.region = q.region || 'all';
    const response = await api.get('/analytics/schools', { params });
    return response.data;
  },
  // bd-97x22y.2 — the Coaching tab's numbers (PLAN v6 §3, served by bd-97x22y.1): same window and region as the
  // schools read, its own endpoint so its cost never slows the other tabs.
  getCoaching: async (q: { from: string | null; to: string | null; region: string | null }): Promise<CoachingAnalyticsResponse> => {
    const params: Record<string, string> = {};
    if (q.from) params.from = q.from;
    if (q.to) params.to = q.to;
    params.region = q.region || 'all';
    const response = await api.get('/analytics/coaching', { params });
    return response.data;
  },
  // bd-97x22y.3 — the LP Engagement tab (schools analytics v7): her formula, her Primary / Mid-High toggle (`band`).
  // Same window and region as the schools read; its own endpoint so its cost never slows the other tabs.
  getLpEngagement: async (q: { from: string | null; to: string | null; region: string | null; band: LpBand }): Promise<LpEngagementResponse> => {
    const params: Record<string, string> = {};
    if (q.from) params.from = q.from;
    if (q.to) params.to = q.to;
    params.region = q.region || 'all';
    params.band = q.band;
    const response = await api.get('/analytics/lp-engagement', { params });
    return response.data;
  },
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
  // Her school list and its teachers — saved by the /observe school and teacher admin. A refusal arrives as an HTTP
  // error whose body carries `reason` (not_found, not_my_school, invalid_phone, is_coach, name_required).
  searchSchools: async (q: string): Promise<{ success: boolean; schools: SchoolHit[] }> => {
    const response = await api.get('/coach/schools/search', { params: { q } });
    return response.data;
  },
  addSchool: async (schoolExtId: string): Promise<{ success: boolean; schoolName?: string | null; emis?: string | null; teacherCount?: number }> => {
    const response = await api.post('/coach/schools', { schoolExtId });
    return response.data;
  },
  removeSchool: async (emis: string): Promise<{ success: boolean; schoolName?: string | null }> => {
    const response = await api.post(`/coach/school/${encodeURIComponent(emis)}/remove`, {});
    return response.data;
  },
  checkTeacher: async (emis: string, phone: string): Promise<{ success: boolean } & TeacherPlan> => {
    const response = await api.post(`/coach/school/${encodeURIComponent(emis)}/teachers/check`, { phone });
    return response.data;
  },
  addTeacher: async (emis: string, phone: string, name: string): Promise<{ success: boolean } & TeacherPlan> => {
    const response = await api.post(`/coach/school/${encodeURIComponent(emis)}/teachers`, { phone, name });
    return response.data;
  },
  removeTeachers: async (emis: string, teacherExtIds: string[], reason: string): Promise<{ success: boolean; removed: { name: string | null }[]; skipped: number; visitsCancelled: number }> => {
    const response = await api.post(`/coach/school/${encodeURIComponent(emis)}/teachers/remove`, { teacherExtIds, reason });
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

  // bd-ql2j3p — off her list. The bot retires a class that is hers alone and empty, and
  // otherwise takes her off it, so a colleague's class or a roster is never lost.
  removeClass: async (classId: string): Promise<{ success: boolean; removed: boolean; how: 'retired' | 'left' | null }> => {
    const response = await api.delete(`/classes/${classId}`);
    return response.data;
  },
};

// ── bd-s1oo0.7: the child test in the coach app ─────────────────────────────
// Every call relays to the bot (dashboard/routes/portal-child-test.routes.js);
// the server's draw picks the children and can never be redrawn from here.

const CT = '/leader/child-test';

export const childTest = {
  getVisits: async (): Promise<{ visits: ChildTestVisit[] }> => (await api.get(`${CT}/visits`)).data,

  getList: async (visitId: string): Promise<{ list: ChildTestList }> =>
    (await api.get(`${CT}/list`, { params: { visitId } })).data,

  markOutcome: async (args: { visitId: string; drawId: string; outcome: 'present' | 'absent' | 'refused'; note?: string }):
    Promise<{ sessionId?: string; list: ChildTestList | null }> => (await api.post(`${CT}/outcome`, args)).data,

  getSession: async (sessionId: string): Promise<ChildTestSession> =>
    (await api.get(`${CT}/session/${encodeURIComponent(sessionId)}`)).data,

  getCard: async (sessionId: string, block: ChildTestBlockName): Promise<{ card: ChildTestCard }> =>
    (await api.get(`${CT}/session/${encodeURIComponent(sessionId)}/card/${block}`)).data,

  presignBlockUpload: async (sessionId: string, args: { block: string; kind: 'audio' | 'photo'; contentType: string; sizeBytes: number }):
    Promise<{ key: string; uploadUrl: string; contentType: string }> =>
    (await api.post(`${CT}/session/${encodeURIComponent(sessionId)}/presign`, args)).data,

  uploadToR2: (uploadUrl: string, blob: Blob, contentType: string): Promise<void> =>
    portal.uploadToR2(uploadUrl, blob, contentType),

  registerBlockMedia: async (sessionId: string, args: { block: string; audioKey?: string; photoKey?: string; timing?: Record<string, unknown>; photoDeclined?: boolean }):
    Promise<{ scoring?: string }> => (await api.post(`${CT}/session/${encodeURIComponent(sessionId)}/media`, args)).data,

  submitCheck: async (sessionId: string, args: { block: ChildTestBlockName; coachMarks: Record<string, unknown> }):
    Promise<{ edits: number; allChecked: boolean }> =>
    (await api.post(`${CT}/session/${encodeURIComponent(sessionId)}/check`, args)).data,
};

// ── The coach's Learning assessment (child test on the SA engine) ──────────
// Relays to the bot like childTest; the server draws the children and names the visit.

const CTS = '/leader/child-test/sa';

export const childTestSa = {
  getSchools: async (): Promise<{ schools: SaSchool[] }> => (await api.get(`${CTS}/schools`)).data,

  /** The page's own switches for this coach (each off unless its app_settings row names them). */
  getSwitches: async (): Promise<SaSwitches> => (await api.get(`${CTS}/switches`)).data.switches,

  /** sa_add_child: seat a child who is not on the roster on the open list; the server answers with the list. */
  addChild: async (args: { schoolId: string; visitId?: string | null; grade: number; listGrade?: number; firstName: string; section?: string | null; clientChildId: string }):
    Promise<{ list: SaList }> => {
    const { visitId, ...rest } = args;
    return (await api.post(`${CTS}/child`, visitId ? { ...rest, visitId } : rest)).data;
  },

  getList: async (schoolId: string, visitId?: string | null, grade?: number): Promise<{ list: SaList }> =>
    (await api.get(`${CTS}/list`, { params: { schoolId, ...(visitId ? { visitId } : {}), ...(grade ? { grade } : {}) } })).data,

  markOutcome: async (args: { schoolId: string; visitId?: string | null; drawId: string; outcome: SaOutcome; note?: string; clientSessionId?: string; block?: SaBlock; repick?: boolean; grade?: number; restart?: boolean }):
    Promise<{ sessionId?: string; list?: SaList | null; block?: SaBlock }> => {
    const { visitId, ...rest } = args;
    return (await api.post(`${CTS}/outcome`, visitId ? { ...rest, visitId } : rest)).data;
  },

  /** sessionId: the server's id or the phone-minted clientSessionId. */
  getStatus: async (sessionId: string): Promise<SaSessionStatus> =>
    (await api.get(`${CTS}/session/${encodeURIComponent(sessionId)}/status`)).data,

  /** One session's results, read only (switch sa_results_view: 404 when off or not this coach's session). */
  getResults: async (sessionId: string): Promise<SaResults> =>
    (await api.get(`${CTS}/session/${encodeURIComponent(sessionId)}/results`)).data,

  /** The results dashboard's sessions: this coach's, or every coach's for a results admin (switch sa_real_dashboard). */
  /** stopSessions (sa_dash_filters only): sessions with a skip/stop but no task yet, for the stops view, never the results. */
  getSessions: async (): Promise<{ sessions: SaDashboardSession[]; stopSessions?: SaDashboardSession[]; practiceFilter?: boolean }> =>
    (await api.get(`${CTS}/sessions`)).data,

  /** The visit review of one session (switch sa_review_page: 404 when off or not this coach's session). */
  getReview: async (sessionId: string): Promise<SaReview> =>
    (await api.get(`${CTS}/session/${encodeURIComponent(sessionId)}/review`)).data,

  /** The reviewer's own mark on one item (null clears it); the note is never a child's name. */
  markReviewItem: async (sessionId: string, body: { taskId: string; itemKey: string; mark: SaEarMark | null; note: string | null }): Promise<{ status: string }> =>
    (await api.post(`${CTS}/session/${encodeURIComponent(sessionId)}/review/mark`, body)).data,

  /** A one-hour token for opening the server's session on another phone. */
  mintLink: async (sessionId: string): Promise<{ token: string; expiresAt: string }> =>
    (await api.post(`${CTS}/session/${encodeURIComponent(sessionId)}/link`)).data,
};

export default api;

// bd-97x22y.4 — the Trainings tab's level progress (PLAN v7): its own read, all time (no window, as hers); the region
// as the other analytics reads ('all' when none), and her Primary / Mid-High toggle as `band`.
export const trainingLevelsAnalytics = {
  get: async (q: { region: string | null; band: import('../types/portal').TrainingBand }): Promise<import('../types/portal').TrainingLevelsResponse> => {
    const response = await api.get('/analytics/training-levels', { params: { region: q.region || 'all', band: q.band } });
    return response.data;
  },
};

// bd-97x22y.5 — the schools analytics Observations tab's numbers (PLAN v7, her FICO section breakdown for Human and
// Digital Coach observations): its own endpoint, same window and region as the schools read (the server 403s anyone
// but an analytics-only account).
export const observationsAnalytics = {
  get: async (q: { from: string | null; to: string | null; region: string | null }): Promise<import('../types/portal').ObservationsAnalyticsResponse> => {
    const params: Record<string, string> = {};
    if (q.from) params.from = q.from;
    if (q.to) params.to = q.to;
    params.region = q.region || 'all';
    const response = await api.get('/analytics/observations', { params });
    return response.data;
  },
};
