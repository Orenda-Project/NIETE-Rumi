import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route, Navigate, useLocation } from "react-router-dom";
import { isPortalTarget } from "@/lib/runtime";
import { Suspense, useEffect } from "react";
import { useTranslation } from "react-i18next";
import NotFound from "./pages/NotFound";
import PortalLogin from "./portal/pages/PortalLogin";
import PortalRoot from "./portal/pages/PortalRoot";
import PortalDashboard from "./portal/pages/PortalDashboard";
import { ASSESSMENT_ROUTES } from "./portal/lib/assessmentRoutes";
import { TRAINING_ROUTES } from "./portal/lib/trainingRoutes";
// bd-fmf24g.1 — the teacher app v2 (behind portal_teacher_v2): every page a feature registers
// in teacher/<folder>/routes.tsx, each one wrapped in the flag gate.
import { TEACHER_ROUTES } from "./portal/teacher/routes";
import TeacherGate from "./portal/teacher/TeacherGate";
import LegacyAttendanceRedirect from "./portal/components/LegacyAttendanceRedirect";
import AppLinkListener from "./portal/components/AppLinkListener";
import BackButtonHandler from "./portal/components/BackButtonHandler";
// bd-5rz1v.10 — a lesson recording that outlives the page it started on.
import { RecordingSessionProvider } from "./portal/lib/recordingSession";
// bd-fxk3t8 — the signed-in user, read once per visit above every route.
import { AuthProvider } from "./portal/hooks/AuthProvider";
import { FrameSkeleton, LoginSkeleton } from "./portal/components/Skeleton";
import { readShellHint } from "./portal/lib/shellHint";
import { lazyPage as page, prefetchPages } from "./lib/lazyPage";
/* Reading assessments + video library are not part of NIETE's launch scope. Routes + imports
 * removed so the URLs 404 rather than expose unfinished screens. Restore by re-adding both
 * imports and the /portal/reading-* + /portal/video* routes below. */

/**
 * bd-fxk3t8 — every page that is not an entry point is its own chunk (lib/lazyPage), so the
 * first paint waits only for what the first screen needs (sign-in, "/", today's Home, the
 * teacher v2 pages). The rest load when first opened — behind the page already on screen
 * (the router's transitions keep it there; no blank, no spinner) — and, once the app is
 * idle, all of them are fetched in the background so a later tap is instant.
 */
const Index = page(() => import("./pages/Index"));
const HowItWorks = page(() => import("./pages/HowItWorks"));
const PortalSetup = page(() => import("./portal/pages/PortalSetup"));
const PortalPasswordReset = page(() => import("./portal/pages/PortalPasswordReset"));
const PortalPasswordResetVerify = page(() => import("./portal/pages/PortalPasswordResetVerify"));
const PortalDeleteAccount = page(() => import("./portal/pages/PortalDeleteAccount"));
const PortalPrivacy = page(() => import("./portal/pages/PortalPrivacy"));
const PortalAccount = page(() => import("./portal/pages/PortalAccount"));
const PortalHomeList = page(() => import("./portal/pages/PortalHomeList"));
const PortalAssessment = page(() => import("./portal/pages/PortalAssessment"));
const PortalClasses = page(() => import("./portal/pages/PortalClasses"));
const PortalCurriculum = page(() => import("./portal/pages/PortalCurriculum"));
const PortalTraining = page(() => import("./portal/pages/PortalTraining"));
const PortalTrainingPage = page(() => import("./portal/pages/PortalTrainingPage"));
const PortalCoaching = page(() => import("./portal/pages/PortalCoaching"));
const PortalCoachingAnalytics = page(() => import("./portal/pages/PortalCoachingAnalytics"));
const PortalCoachingDetail = page(() => import("./portal/pages/PortalCoachingDetail"));
const PortalCoachingRecord = page(() => import("./portal/pages/PortalCoachingRecord"));
const LeaderHome = page(() => import("./portal/pages/LeaderHome"));
const LeaderTeachers = page(() => import("./portal/pages/LeaderTeachers"));
const LeaderTeacherDetail = page(() => import("./portal/pages/LeaderTeacherDetail"));
const LeaderObservations = page(() => import("./portal/pages/LeaderObservations"));
const LeaderObserveRecord = page(() => import("./portal/pages/LeaderObserveRecord"));
const LeaderObservation = page(() => import("./portal/pages/LeaderObservation"));
const LeaderObserveDraft = page(() => import("./portal/pages/LeaderObserveDraft"));
const LeaderObserveTalk = page(() => import("./portal/pages/LeaderObserveTalk"));
// bd-o15qnr — the coach app v2 (behind portal_coach_v2; each page gates itself).
const CoachHome = page(() => import("./portal/coach/pages/CoachHome"));
const CoachScheduling = page(() => import("./portal/coach/pages/CoachScheduling"));
const CoachSchedule = page(() => import("./portal/coach/pages/CoachSchedule"));
const CoachTeam = page(() => import("./portal/coach/pages/CoachTeam"));
const CoachNewVisit = page(() => import("./portal/coach/pages/CoachNewVisit"));
const CoachObserve = page(() => import("./portal/coach/pages/CoachObserve"));
const CoachObservePick = page(() => import("./portal/coach/pages/CoachObservePick"));
const CoachVisit = page(() => import("./portal/coach/pages/CoachVisit"));
const CoachReports = page(() => import("./portal/coach/pages/CoachReports"));
const CoachPeople = page(() => import("./portal/coach/pages/CoachPeople"));
const CoachAnalytics = page(() => import("./portal/coach/analytics/CoachAnalytics").then((m) => ({ default: m.CoachAnalytics })));
const CoachTeacherAnalytics = page(() => import("./portal/coach/analytics/CoachAnalytics").then((m) => ({ default: m.CoachTeacherAnalytics })));
const CoachSchool = page(() => import("./portal/coach/pages/CoachSchool"));
const CoachTeacher = page(() => import("./portal/coach/pages/CoachTeacher"));
const CoachRecord = page(() => import("./portal/coach/pages/CoachRecord"));
const CoachAttach = page(() => import("./portal/coach/pages/CoachAttach"));
const CoachCheckSend = page(() => import("./portal/coach/pages/CoachCheckSend"));
const CoachSending = page(() => import("./portal/coach/pages/CoachSending"));
const CoachObservation = page(() => import("./portal/coach/pages/CoachObservation"));
// bd-4404s7.5 — Reports: All Observations, and the four screens of one observation.
const CoachReportsAll = page(() => import("./portal/coach/reports/CoachReportsAll"));
const CoachFeedbackForm = page(() => import("./portal/coach/reports/FeedbackForm"));
const CoachDebrief = page(() => import("./portal/coach/reports/Debrief"));
const CoachYourFeedback = page(() => import("./portal/coach/reports/YourFeedback"));
const CoachSendReport = page(() => import("./portal/coach/reports/SendReport"));
const CoachEditTeacher = page(() => import("./portal/coach/pages/CoachEditTeacher"));
// bd-4404s7.2 — the coach's More and her own profile.
const CoachMore = page(() => import("./portal/coach/profile/CoachMore"));
const CoachProfile = page(() => import("./portal/coach/profile/CoachProfile"));
// bd-60117 — a principal's school-level Analytics tab.
const SchoolAnalytics = page(() => import("./portal/pages/SchoolAnalytics"));
// bd-60121 — every observed lesson, its own page.
const SchoolLessons = page(() => import("./portal/pages/SchoolLessons"));

/** While a page's chunk arrives on a cold start at that page: its outline, never a spinner. */
function RouteFallback() {
  const { pathname } = useLocation();
  if (/^\/portal\/(setup|reset-password|delete-account|privacy)/.test(pathname) || pathname === "/how-it-works") {
    return <LoginSkeleton />;
  }
  return <FrameSkeleton variant={readShellHint() ?? "classic"} />;
}

const queryClient = new QueryClient();

const App = () => {
  const { i18n } = useTranslation();
  // In the Android app the WebView host is `localhost`, so a hostname check
  // alone would render the marketing splash instead of the portal.
  const isPortalSubdomain = isPortalTarget();

  useEffect(() => {
    prefetchPages();
  }, []);

  useEffect(() => {
    // Update the lang attribute on the HTML element
    const currentLang = i18n.language;
    document.documentElement.setAttribute('lang', currentLang);

    // Set direction for RTL languages
    if (currentLang === 'ur') {
      document.documentElement.setAttribute('dir', 'rtl');
    } else {
      document.documentElement.setAttribute('dir', 'ltr');
    }

    // Wait for Google Fonts to load before rendering
    if (document.fonts) {
      document.fonts.ready.then(() => {
        console.log('Fonts loaded for language:', currentLang);
      });
    }
  }, [i18n.language]);

  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <Toaster />
        <Sonner />
        {/* bd-fxk3t8 — v7_startTransition: moving to a page whose chunk is still on its way
            keeps the current page on screen until it is ready (no blank, no fallback). */}
        <BrowserRouter future={{ v7_startTransition: true }}>
          {/* bd-fxk3t8 — the signed-in user lives here, above the routes, so moving
              between pages never reads it again or blanks the screen for it. */}
          <AuthProvider>
          {/* bd-5rz1v.10 — the lesson being recorded lives here, above the
              routes, so moving between pages never stops it. Inside the router
              so its bar's Return and the back key can navigate. */}
          <RecordingSessionProvider>
          {/* Android app only: routes a tapped portal link to its page. */}
          <AppLinkListener />
          {/* Android app only: the hardware back key (close / back / leave). */}
          <BackButtonHandler />
          <Suspense fallback={<RouteFallback />}>
          <Routes>
            {/* bd-2394: for the portal audience "/" resolves against the
                session (PortalRoot), not straight to the login form — the
                Android app cold-boots here on every launch. The marketing
                site is unchanged. */}
            <Route path="/" element={isPortalSubdomain ? <PortalRoot /> : <Index />} />
            <Route path="/how-it-works" element={<HowItWorks />} />
            
            {/* Portal Routes */}
          <Route path="/portal/setup/:token" element={<PortalSetup />} />
          <Route path="/portal/login" element={<PortalLogin />} />
          <Route path="/portal/reset-password" element={<PortalPasswordReset />} />
          <Route path="/portal/reset-password/verify" element={<PortalPasswordResetVerify />} />
          {/* bd-3wb0s — Google Play's account-deletion URL. PUBLIC like the
              routes above: no PortalLayout, no session check, so it works
              signed out, signed in, and without the app. */}
          <Route path="/portal/delete-account" element={<PortalDeleteAccount />} />
          {/* bd-nvnf2 — the NIETE privacy policy, the URL in Play Console. PUBLIC
              for the same reason: Play opens it signed out, outside the app. */}
          <Route path="/portal/privacy" element={<PortalPrivacy />} />
          <Route path="/portal/dashboard" element={<PortalDashboard />} />
          {/* bd-5rz1v.17 — the lists behind the new Home's tiles (new UI only; flag off → the dashboard). */}
          <Route path="/portal/dashboard/:metric" element={<PortalHomeList />} />
          {/* bd-5rz1v.13 — Assessment, its own pages (new UI only; flag off → the Curriculum tab). */}
          {ASSESSMENT_ROUTES.map((r) => <Route key={r.path} path={r.path} element={<PortalAssessment view={r.view} />} />)}
          {/* bd-3wb0s — My account: her name and school, the privacy policy,
              account deletion and Logout. Signed-in only (PortalLayout). */}
          <Route path="/portal/account" element={<PortalAccount />} />
            {/* bd-60078 — My Plans is retired. It listed a teacher's own
                Gamma-generated plans, and custom generation is off, so the page
                could only ever show older work with no way to make more.

                REDIRECTED rather than deleted: the path is in browser history
                and on saved links, and a 404 for something that worked
                yesterday reads as the portal being broken. Curriculum is the
                lesson plans she can actually still use. `replace` so the back
                button does not bounce her straight back here. */}
            <Route
              path="/portal/lesson-plans"
              element={<Navigate to="/portal/curriculum" replace />}
            />
            <Route path="/portal/classes" element={<PortalClasses />} />
            <Route path="/portal/curriculum" element={<PortalCurriculum />} />
            {/* bd-60160 — the redesigned page IS the training page now.
                /portal/training serves it; the nav needs no change because it
                already points there.

                The old page stays reachable at /portal/training/v1 rather than
                being deleted, so a rollback is repointing ONE route back
                instead of a revert, and anyone mid-session on the old URL is
                not stranded. /v2 keeps working too — it has been handed out in
                this session and in review links, and a dead link is a worse
                answer than a duplicate one. */}
            <Route path="/portal/training/v1" element={<PortalTraining />} />
            {/* Every v2 page under both bases — the training page, its
                certificates page, a provider, a level, a course (bd-klecr),
                and the unit and exam pages (bd-60152). One list, shared with
                the page tests, so a URL the page navigates to cannot go
                unserved. /v2 stays alive because it was handed out.
                bd-5rz1v.25 — through PortalTrainingPage: the new Training screens
                with portal_new_ui on, PortalTrainingV2 unchanged otherwise. */}
            {TRAINING_ROUTES.map(r => (
              <Route key={r.path} path={r.path} element={<PortalTrainingPage view={r.view} />} />
            ))}
            <Route path="/portal/coaching" element={<PortalCoaching />} />
            <Route path="/portal/coaching/analytics" element={<PortalCoachingAnalytics />} />
            <Route path="/portal/coaching/new" element={<PortalCoachingRecord />} />
            <Route path="/portal/coaching/session/:sessionId" element={<PortalCoachingDetail />} />

            {/* Leader Portal (bd-2434) — role-gated inside the pages; the leader
                nav + My Patch only render for the school-leader family. */}
            <Route path="/portal/leader" element={<LeaderHome />} />
            <Route path="/portal/leader/teachers" element={<LeaderTeachers />} />
            <Route path="/portal/leader/observations" element={<LeaderObservations />} />
            {/* bd-5rz1v.6 — a coach's /observe observation from the portal (dark behind portal_coach_observation). */}
            <Route path="/portal/leader/observe/new" element={<LeaderObserveRecord />} />
            <Route path="/portal/leader/observe/:id" element={<LeaderObservation />} />
            <Route path="/portal/leader/observe/:id/draft" element={<LeaderObserveDraft />} />
            <Route path="/portal/leader/observe/:id/talk" element={<LeaderObserveTalk />} />
            {/* bd-o15qnr — the coach app v2: role=coach + portal_coach_v2 only; anyone
                else who lands here is sent to My Patch by the page's own gate. */}
            <Route path="/portal/coach" element={<CoachHome />} />
            <Route path="/portal/coach/scheduling" element={<CoachScheduling />} />
            <Route path="/portal/coach/schedule" element={<CoachSchedule />} />
            <Route path="/portal/coach/team" element={<CoachTeam />} />
            <Route path="/portal/coach/new-visit" element={<CoachNewVisit />} />
            <Route path="/portal/coach/observe" element={<CoachObserve />} />
            <Route path="/portal/coach/observe/pick" element={<CoachObservePick />} />
            <Route path="/portal/coach/visit/:id" element={<CoachVisit />} />
            {/* bd-o15qnr.9 — taking the observation, in v2: Record live, Upload recording, Check and send. */}
            <Route path="/portal/coach/visit/:id/record" element={<CoachRecord />} />
            <Route path="/portal/coach/visit/:id/attach" element={<CoachAttach />} />
            <Route path="/portal/coach/visit/:id/check" element={<CoachCheckSend />} />
            <Route path="/portal/coach/visit/:id/sending" element={<CoachSending />} />
            <Route path="/portal/coach/reports" element={<CoachReports />} />
            <Route path="/portal/coach/reports/all" element={<CoachReportsAll />} />
            <Route path="/portal/coach/people" element={<CoachPeople />} />
            {/* bd-fmf24g.27 — the coach's Analytics, and one of her teachers */}
            <Route path="/portal/coach/analytics" element={<CoachAnalytics />} />
            <Route path="/portal/coach/analytics/teacher/:ext" element={<CoachTeacherAnalytics />} />
            <Route path="/portal/coach/school/:emis" element={<CoachSchool />} />
            <Route path="/portal/coach/teacher/:ext" element={<CoachTeacher />} />
            {/* bd-o15qnr.10 — one HITL report, from a teacher's History */}
            <Route path="/portal/coach/observation/:id" element={<CoachObservation />} />
            <Route path="/portal/coach/observation/:id/form" element={<CoachFeedbackForm />} />
            <Route path="/portal/coach/observation/:id/debrief" element={<CoachDebrief />} />
            <Route path="/portal/coach/observation/:id/feedback" element={<CoachYourFeedback />} />
            <Route path="/portal/coach/observation/:id/send" element={<CoachSendReport />} />
            {/* bd-o15qnr.11 — Edit teacher (saved by the /observe teacher admin) */}
            <Route path="/portal/coach/teacher/:ext/edit" element={<CoachEditTeacher />} />
            {/* bd-4404s7.2 — the coach menu and her own profile. */}
            <Route path="/portal/coach/more" element={<CoachMore />} />
            <Route path="/portal/coach/profile" element={<CoachProfile />} />
            {/* bd-fmf24g.1 — the teacher app v2: teachers with portal_teacher_v2 only; anyone else
                is sent to today's Home by the gate. Pages register themselves (teacher/routes.tsx). */}
            {TEACHER_ROUTES.map((r) => (
              <Route key={r.path} path={r.path} element={<TeacherGate>{r.element}</TeacherGate>} />
            ))}
            {/* bd-60117 — principals only; the endpoint 403s the rest of
                the leader family and the page says so rather than showing
                one school's numbers to a multi-school role. */}
            <Route path="/portal/leader/school-analytics" element={<SchoolAnalytics />} />
            <Route path="/portal/leader/attendance" element={<LegacyAttendanceRedirect to="/portal/leader/school-analytics" />} />
            <Route path="/portal/attendance" element={<LegacyAttendanceRedirect to="/portal/coaching/analytics" />} />
            <Route path="/portal/leader/lessons" element={<SchoolLessons />} />
            <Route path="/portal/leader/teacher/:id" element={<LeaderTeacherDetail />} />

            {/* ADD ALL CUSTOM ROUTES ABOVE THE CATCH-ALL "*" ROUTE */}
            <Route path="*" element={<NotFound />} />
          </Routes>
          </Suspense>
          </RecordingSessionProvider>
          </AuthProvider>
        </BrowserRouter>
      </TooltipProvider>
    </QueryClientProvider>
  );
};

export default App;
