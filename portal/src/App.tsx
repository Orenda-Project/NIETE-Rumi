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
import { ASSESSMENT_ROUTES } from "./portal/lib/assessmentRoutes";
import { TRAINING_ROUTES } from "./portal/lib/trainingRoutes";
// bd-fmf24g.1 — the teacher app v2 (behind portal_teacher_v2): every page a feature registers
// in teacher/<folder>/routes.tsx, each one wrapped in the flag gate.
import { TEACHER_ROUTES } from "./portal/teacher/routes";
import TeacherGate from "./portal/teacher/TeacherGate";
import LegacyAttendanceRedirect from "./portal/components/LegacyAttendanceRedirect";
import AppLinkListener from "./portal/components/AppLinkListener";
import BackButtonHandler from "./portal/components/BackButtonHandler";
// bd-4r3rei — which pages she opens and when she leaves them (the teacher-app funnel). Renders nothing.
import AppFunnelTracker from "./portal/components/AppFunnelTracker";
// bd-s6qbts.3 — analytics-only accounts see one page; everyone else never sees it (portal/lib/homeRoute).
import AnalyticsOnlyGuard from "./portal/analytics/AnalyticsOnlyGuard";
import CoachAppGuard from "./portal/coach/training/CoachAppGuard";
// bd-5rz1v.10 — a lesson recording that outlives the page it started on.
import { RecordingSessionProvider } from "./portal/lib/recordingSession";
// bd-fxk3t8 — the signed-in user, read once per visit above every route.
import { AuthProvider } from "./portal/hooks/AuthProvider";
import { FrameSkeleton, LoginSkeleton } from "./portal/components/Skeleton";
import { readShellHint } from "./portal/lib/shellHint";
import { lazyPage as page, prefetchPages } from "./lib/lazyPage";
import { warmFirstScreen } from "./lib/firstScreen";
import { primeRead, primeWhenCoachipOn } from "./lib/bootReads";
import houseApi from "./portal/services/api";
import { readConfigShared } from "./portal/lib/useNewUi";
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
// bd-sex15q.34 — the teacher dashboard is its own chunk too (with its charts it was a third of the first chunk every
// coach waited for); a teacher's first screen is asked for at boot instead (lib/firstScreen).
const loadDashboard = () => import("./portal/pages/PortalDashboard");
const PortalDashboard = page(loadDashboard);
// Any /portal/ page is the portal whatever the host (sandbox's portal-sandbox.… host is not a "portal." one); "/" only
// on a portal host (elsewhere it is the marketing site).
if (typeof window !== "undefined" && (isPortalTarget() || window.location.pathname.startsWith("/portal/"))) {
  warmFirstScreen(window.location.pathname, readShellHint(), {
    dashboard: loadDashboard,
    teacherHome: () => import("./portal/teacher/pages/Home"),
    coachInsights: () => Promise.all([
      import("./portal/coach/insights/routes"),
      import("./portal/coach/insights/pages/ThisWeek"),
      // COS 105750: This week's data too, once /config says the switch is on (never a /coachip/ request otherwise).
      // From this chunk, not COACHIP's api chunk, so it does not wait for that chunk to arrive (same key and store).
      primeWhenCoachipOn(readConfigShared, () => primeRead("coachip/home", () => houseApi.get("/coachip/home").then((r) => r.data))),
    ]),
    rm: () => import("./portal/rm/routes"),
    config: readConfigShared,
  });
}
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
const LeaderChildTest = page(() => import("./portal/pages/LeaderChildTest"));
const LeaderAssess = page(() => import("./portal/pages/LeaderAssess"));
const LeaderAssessResults = page(() => import("./portal/pages/LeaderAssessResults"));
const LeaderAssessDashboard = page(() => import("./portal/pages/LeaderAssessDashboard"));
const LeaderAssessReview = page(() => import("./portal/pages/LeaderAssessReview"));
const LeaderObserveRecord = page(() => import("./portal/pages/LeaderObserveRecord"));
const LeaderObservation = page(() => import("./portal/pages/LeaderObservation"));
const LeaderObserveDraft = page(() => import("./portal/pages/LeaderObserveDraft"));
const LeaderObserveTalk = page(() => import("./portal/pages/LeaderObserveTalk"));
// bd-o15qnr — the coach app v2 (behind portal_coach_v2; each page gates itself).
// /portal/coach: the slim Coach Home with the School card switch on, else the coach Home (card/CoachLanding).
const CoachLanding = page(() => import("./portal/coach/card/CoachLanding"));
// The School card's own pages (each shows Not found unless the switch is on for her).
const CoachFeatureGrid = page(() => import("./portal/coach/card/FeatureGridPage"));
const CoachHerItems = page(() => import("./portal/coach/card/HerItemsPage"));
// Her days: each day she used NIETE and what she used (bd-dgfkgs.4).
const CoachHerDays = page(() => import("./portal/coach/card/DaysUsedPage"));
// Her Digital Coaching and her Coach observations (one page, two addresses); the old Her coaching reports, her DC and
// coach-visit lists and /coaching open them.
const CoachTeacherScores = page(() => import("./portal/coach/card/TeacherScoresPage"));
const CoachCoachingRedirect = page(() => import("./portal/coach/card/CoachingRedirect"));
const CoachSessionReport = page(() => import("./portal/coach/card/SessionReportPage"));
const CoachScheduling = page(() => import("./portal/coach/pages/CoachScheduling"));
const CoachSchedule = page(() => import("./portal/coach/pages/CoachSchedule"));
const CoachTeam = page(() => import("./portal/coach/pages/CoachTeam"));
const CoachNewVisit = page(() => import("./portal/coach/pages/CoachNewVisit"));
const CoachObserve = page(() => import("./portal/coach/pages/CoachObserve"));
const CoachObservePick = page(() => import("./portal/coach/pages/CoachObservePick"));
const CoachVisit = page(() => import("./portal/coach/pages/CoachVisit"));
const CoachReports = page(() => import("./portal/coach/pages/CoachReports"));
const CoachDisagreements = page(() => import("./portal/coach/disagreements/DisagreementsPage"));
const CoachDisagreement = page(() => import("./portal/coach/disagreements/DisagreementCard"));
const CoachPeople = page(() => import("./portal/coach/pages/CoachPeople"));
const CoachAnalytics = page(() => import("./portal/coach/analytics/CoachAnalytics").then((m) => ({ default: m.CoachAnalytics })));
const CoachTeacherAnalytics = page(() => import("./portal/coach/analytics/CoachAnalytics").then((m) => ({ default: m.CoachTeacherAnalytics })));
const CoachSchool = page(() => import("./portal/coach/pages/CoachSchool"));
const CoachAddSchool = page(() => import("./portal/coach/pages/CoachAddSchool"));
const CoachAddTeacher = page(() => import("./portal/coach/pages/CoachAddTeacher"));
const CoachRemoveTeachers = page(() => import("./portal/coach/pages/CoachRemoveTeachers"));
const CoachPickTeacher = page(() => import("./portal/coach/pages/CoachPickTeacher"));
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
// bd-sex15q.15 — COACHIP, the coach insight pages (each gates itself on portal_coachip).
const CoachInsights = page(() => import("./portal/coach/insights/routes"));
// bd-sex15q.17 — COACHIP, the RM pages (their own gate on GET /coachip/me → rm; never CoachGate).
const RmPages = page(() => import("./portal/rm/routes"));
const CoachProfile = page(() => import("./portal/coach/profile/CoachProfile"));
// bd-s42dye.2 — the coach's Training Library (every provider, level, course and part; questions are a read-only preview).
const CoachLibraryHome = page(() => import("./portal/coach/training/LibraryPages").then((m) => ({ default: m.LibraryHome })));
const CoachLibraryProvider = page(() => import("./portal/coach/training/LibraryPages").then((m) => ({ default: m.LibraryProvider })));
const CoachLibraryModule = page(() => import("./portal/coach/training/LibraryPages").then((m) => ({ default: m.LibraryModulePage })));
const CoachLibraryPreview = page(() => import("./portal/coach/training/LibraryPages").then((m) => ({ default: m.LibraryPreview })));
// bd-60117 — a principal's school-level Analytics tab.
const SchoolAnalytics = page(() => import("./portal/pages/SchoolAnalytics"));
// bd-60121 — every observed lesson, its own page.
const SchoolLessons = page(() => import("./portal/pages/SchoolLessons"));
// bd-s6qbts.3 — school-wise analytics for analytics-only accounts (FDE / AEO).
const SchoolsAnalytics = page(() => import("./portal/analytics/SchoolsAnalytics"));
// The analytics accounts' own sign-in: an account name and a password (portal/auth/AnalyticsLogin).
const AnalyticsLogin = page(() => import("./portal/auth/AnalyticsLogin"));
const FlnRoutes = page(() => import("./portal/fln/FlnRoutes"));

/** While a page's chunk arrives on a cold start at that page: its outline, never a spinner. */
function RouteFallback() {
  const { pathname } = useLocation();
  if (/^\/portal\/(setup|reset-password|delete-account|privacy|analytics\/login)/.test(pathname) || pathname === "/how-it-works") {
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
          <AppFunnelTracker />
          {/* Android app only: the hardware back key (close / back / leave). */}
          <BackButtonHandler />
          <Suspense fallback={<RouteFallback />}>
          {/* bd-s6qbts.3 — one guard over every route: an analytics-only account is sent to its page from any
              other portal page (before that page mounts), and anyone else who opens it goes to their own home. */}
          {/* bd-s42dye.2 — a coach on the coach app v2 reaches the Training Library and her account only. */}
          <CoachAppGuard>
          <AnalyticsOnlyGuard>
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
            {/* bd-s1oo0.7 — the child test in the coach app; the page and the
                API both check the portal_child_test flag. */}
            <Route path="/portal/leader/child-test" element={<LeaderChildTest />} />
            {/* The coach's Learning assessment; the page and the API both check portal_child_test_sa. */}
            <Route path="/portal/leader/assess" element={<LeaderAssess />} />
            {/* One session's results (read only); the API checks sa_results_view. */}
            <Route path="/portal/leader/assess/results/:sessionId" element={<LeaderAssessResults />} />
            {/* The example results dashboard (synthetic data); the page checks sa_example_dashboard, sandbox only. */}
            <Route path="/portal/leader/assess/dashboard" element={<LeaderAssessDashboard />} />
            <Route path="/portal/leader/assess/review" element={<LeaderAssessReview />} />
            <Route path="/portal/leader/assess/review/:sessionId" element={<LeaderAssessReview />} />
            {/* bd-5rz1v.6 — a coach's /observe observation from the portal (dark behind portal_coach_observation). */}
            <Route path="/portal/leader/observe/new" element={<LeaderObserveRecord />} />
            <Route path="/portal/leader/observe/:id" element={<LeaderObservation />} />
            <Route path="/portal/leader/observe/:id/draft" element={<LeaderObserveDraft />} />
            <Route path="/portal/leader/observe/:id/talk" element={<LeaderObserveTalk />} />
            {/* bd-o15qnr — the coach app v2: role=coach + portal_coach_v2 only; anyone
                else who lands here is sent to My Patch by the page's own gate. */}
            <Route path="/portal/coach" element={<CoachLanding />} />
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
            <Route path="/portal/coach/disagreements" element={<CoachDisagreements />} />
            <Route path="/portal/coach/disagreements/:id" element={<CoachDisagreement />} />
            <Route path="/portal/coach/people" element={<CoachPeople />} />
            {/* bd-fmf24g.27 — the coach's Analytics, and one of her teachers */}
            <Route path="/portal/coach/analytics" element={<CoachAnalytics />} />
            <Route path="/portal/coach/analytics/teacher/:ext" element={<CoachTeacherAnalytics />} />
            <Route path="/portal/coach/school/:emis" element={<CoachSchool />} />
            <Route path="/portal/coach/school/:emis/feature/:feature" element={<CoachFeatureGrid />} />
            {/* Her school list and its teachers: the WhatsApp /observe "Add or remove a school" and "Manage teachers". */}
            <Route path="/portal/coach/schools/add" element={<CoachAddSchool />} />
            <Route path="/portal/coach/add-teacher" element={<CoachAddTeacher />} />
            <Route path="/portal/coach/school/:emis/add-teacher" element={<CoachAddTeacher />} />
            <Route path="/portal/coach/school/:emis/remove-teachers" element={<CoachRemoveTeachers />} />
            <Route path="/portal/coach/school/:emis/edit-teacher" element={<CoachPickTeacher />} />
            <Route path="/portal/coach/teacher/:ext" element={<CoachTeacher />} />
            <Route path="/portal/coach/teacher/:ext/items/:feature" element={<CoachHerItems />} />
            <Route path="/portal/coach/teacher/:ext/days" element={<CoachHerDays />} />
            <Route path="/portal/coach/teacher/:ext/dc" element={<CoachTeacherScores />} />
            <Route path="/portal/coach/teacher/:ext/observations" element={<CoachTeacherScores />} />
            <Route path="/portal/coach/teacher/:ext/coaching" element={<CoachCoachingRedirect />} />
            <Route path="/portal/coach/teacher/:ext/reports" element={<CoachCoachingRedirect />} />
            <Route path="/portal/coach/teacher/:ext/items/dc" element={<CoachCoachingRedirect />} />
            <Route path="/portal/coach/teacher/:ext/items/coach" element={<CoachCoachingRedirect />} />
            <Route path="/portal/coach/session/:id" element={<CoachSessionReport />} />
            {/* bd-o15qnr.10 — one HITL report, from a teacher's History */}
            <Route path="/portal/coach/observation/:id" element={<CoachObservation />} />
            <Route path="/portal/coach/observation/:id/form" element={<CoachFeedbackForm />} />
            <Route path="/portal/coach/observation/:id/debrief" element={<CoachDebrief />} />
            <Route path="/portal/coach/observation/:id/feedback" element={<CoachYourFeedback />} />
            <Route path="/portal/coach/observation/:id/send" element={<CoachSendReport />} />
            {/* bd-o15qnr.11 — Edit teacher (saved by the /observe teacher admin) */}
            <Route path="/portal/coach/teacher/:ext/edit" element={<CoachEditTeacher />} />
            {/* bd-4404s7.2 — the coach menu and her own profile. */}
            <Route path="/portal/coach/insights/*" element={<CoachInsights />} />
            <Route path="/portal/rm/*" element={<RmPages />} />
            <Route path="/portal/coach/more" element={<CoachMore />} />
            <Route path="/portal/coach/profile" element={<CoachProfile />} />
            {/* bd-s42dye.2 — the Training Library, behind the same CoachGate (each page gates itself). */}
            <Route path="/portal/coach/training" element={<CoachLibraryHome />} />
            <Route path="/portal/coach/training/module/:id" element={<CoachLibraryModule />} />
            <Route path="/portal/coach/training/preview" element={<CoachLibraryPreview />} />
            <Route path="/portal/coach/training/:vendorKey" element={<CoachLibraryProvider />} />
            {/* bd-fmf24g.1 — the teacher app v2: teachers with portal_teacher_v2 only; anyone else
                is sent to today's Home by the gate. Pages register themselves (teacher/routes.tsx).
                bd-4joiqz — a route marked `leaders` (the Lesson Plans pages) also opens for the leader family. */}
            {TEACHER_ROUTES.map((r) => (
              <Route key={r.path} path={r.path} element={<TeacherGate leaders={r.leaders}>{r.element}</TeacherGate>} />
            ))}
            {/* bd-60117 — principals only; the endpoint 403s the rest of
                the leader family and the page says so rather than showing
                one school's numbers to a multi-school role. */}
            <Route path="/portal/leader/school-analytics" element={<SchoolAnalytics />} />
            <Route path="/portal/leader/attendance" element={<LegacyAttendanceRedirect to="/portal/leader/school-analytics" />} />
            <Route path="/portal/attendance" element={<LegacyAttendanceRedirect to="/portal/coaching/analytics" />} />
            <Route path="/portal/leader/lessons" element={<SchoolLessons />} />
            <Route path="/portal/leader/teacher/:id" element={<LeaderTeacherDetail />} />
            {/* bd-97x22y.2 — the page and its six tabs (/portal/analytics/schools/<tab>), one route so a tab change
                keeps the page and its numbers. */}
            <Route path="/portal/analytics/schools/:tab?" element={<SchoolsAnalytics />} />
            {/* PUBLIC, like /portal/login: the analytics accounts' own sign-in (name + password). lib/homeRoute keeps
                the guard off it, and the API client's 401 handler leaves it in place. */}
            <Route path="/portal/analytics/login" element={<AnalyticsLogin />} />

            <Route path="/portal/fln/*" element={<FlnRoutes />} />
            {/* ADD ALL CUSTOM ROUTES ABOVE THE CATCH-ALL "*" ROUTE */}
            <Route path="*" element={<NotFound />} />
          </Routes>
          </AnalyticsOnlyGuard>
          </CoachAppGuard>
          </Suspense>
          </RecordingSessionProvider>
          </AuthProvider>
        </BrowserRouter>
      </TooltipProvider>
    </QueryClientProvider>
  );
};

export default App;
