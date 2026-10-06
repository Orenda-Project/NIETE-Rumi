import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { isPortalTarget } from "@/lib/runtime";
import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import Index from "./pages/Index";
import HowItWorks from "./pages/HowItWorks";
import NotFound from "./pages/NotFound";
import PortalSetup from "./portal/pages/PortalSetup";
import PortalLogin from "./portal/pages/PortalLogin";
import PortalRoot from "./portal/pages/PortalRoot";
import PortalPasswordReset from "./portal/pages/PortalPasswordReset";
import PortalPasswordResetVerify from "./portal/pages/PortalPasswordResetVerify";
import PortalDeleteAccount from "./portal/pages/PortalDeleteAccount";
import PortalPrivacy from "./portal/pages/PortalPrivacy";
import PortalAccount from "./portal/pages/PortalAccount";
import PortalDashboard from "./portal/pages/PortalDashboard";
import PortalHomeList from "./portal/pages/PortalHomeList";
import PortalAssessment from "./portal/pages/PortalAssessment";
import { ASSESSMENT_ROUTES } from "./portal/lib/assessmentRoutes";
import PortalClasses from "./portal/pages/PortalClasses";
import PortalCurriculum from "./portal/pages/PortalCurriculum";
import PortalTraining from "./portal/pages/PortalTraining";
import PortalTrainingPage from "./portal/pages/PortalTrainingPage";
import { TRAINING_ROUTES } from "./portal/lib/trainingRoutes";
import PortalCoaching from "./portal/pages/PortalCoaching";
import PortalCoachingAnalytics from "./portal/pages/PortalCoachingAnalytics";
import PortalCoachingDetail from "./portal/pages/PortalCoachingDetail";
import PortalCoachingRecord from "./portal/pages/PortalCoachingRecord";
import LeaderHome from "./portal/pages/LeaderHome";
import LeaderTeachers from "./portal/pages/LeaderTeachers";
import LeaderTeacherDetail from "./portal/pages/LeaderTeacherDetail";
import LeaderObservations from "./portal/pages/LeaderObservations";
import LeaderChildTest from "./portal/pages/LeaderChildTest";
import LeaderObserveRecord from "./portal/pages/LeaderObserveRecord";
import LeaderObservation from "./portal/pages/LeaderObservation";
import LeaderObserveDraft from "./portal/pages/LeaderObserveDraft";
import LeaderObserveTalk from "./portal/pages/LeaderObserveTalk";
// bd-o15qnr — the coach app v2 (behind portal_coach_v2; each page gates itself).
import CoachHome from "./portal/coach/pages/CoachHome";
import CoachScheduling from "./portal/coach/pages/CoachScheduling";
import CoachSchedule from "./portal/coach/pages/CoachSchedule";
import CoachTeam from "./portal/coach/pages/CoachTeam";
import CoachNewVisit from "./portal/coach/pages/CoachNewVisit";
import CoachObserve from "./portal/coach/pages/CoachObserve";
import CoachObservePick from "./portal/coach/pages/CoachObservePick";
import CoachVisit from "./portal/coach/pages/CoachVisit";
import CoachReports from "./portal/coach/pages/CoachReports";
import CoachPeople from "./portal/coach/pages/CoachPeople";
import CoachSchool from "./portal/coach/pages/CoachSchool";
import CoachTeacher from "./portal/coach/pages/CoachTeacher";
import CoachRecord from "./portal/coach/pages/CoachRecord";
import CoachAttach from "./portal/coach/pages/CoachAttach";
import CoachCheckSend from "./portal/coach/pages/CoachCheckSend";
import CoachObservation from "./portal/coach/pages/CoachObservation";
import CoachEditTeacher from "./portal/coach/pages/CoachEditTeacher";
// bd-60117 — a principal's school-level Analytics tab.
import SchoolAnalytics from "./portal/pages/SchoolAnalytics";
import LegacyAttendanceRedirect from "./portal/components/LegacyAttendanceRedirect";
import AppLinkListener from "./portal/components/AppLinkListener";
import BackButtonHandler from "./portal/components/BackButtonHandler";
// bd-5rz1v.10 — a lesson recording that outlives the page it started on.
import { RecordingSessionProvider } from "./portal/lib/recordingSession";
// bd-60121 — every observed lesson, its own page.
import SchoolLessons from "./portal/pages/SchoolLessons";
/* Reading assessments + video library are not part of NIETE's launch scope. Routes + imports
 * removed so the URLs 404 rather than expose unfinished screens. Restore by re-adding both
 * imports and the /portal/reading-* + /portal/video* routes below. */

const queryClient = new QueryClient();

const App = () => {
  const { i18n } = useTranslation();
  // In the Android app the WebView host is `localhost`, so a hostname check
  // alone would render the marketing splash instead of the portal.
  const isPortalSubdomain = isPortalTarget();

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
        <BrowserRouter>
          {/* bd-5rz1v.10 — the lesson being recorded lives here, above the
              routes, so moving between pages never stops it. Inside the router
              so its bar's Return and the back key can navigate. */}
          <RecordingSessionProvider>
          {/* Android app only: routes a tapped portal link to its page. */}
          <AppLinkListener />
          {/* Android app only: the hardware back key (close / back / leave). */}
          <BackButtonHandler />
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
            <Route path="/portal/coach/reports" element={<CoachReports />} />
            <Route path="/portal/coach/people" element={<CoachPeople />} />
            <Route path="/portal/coach/school/:emis" element={<CoachSchool />} />
            <Route path="/portal/coach/teacher/:ext" element={<CoachTeacher />} />
            {/* bd-o15qnr.10 — one HITL report, from a teacher's History */}
            <Route path="/portal/coach/observation/:id" element={<CoachObservation />} />
            {/* bd-o15qnr.11 — Edit teacher (saved by the /observe teacher admin) */}
            <Route path="/portal/coach/teacher/:ext/edit" element={<CoachEditTeacher />} />
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
          </RecordingSessionProvider>
        </BrowserRouter>
      </TooltipProvider>
    </QueryClientProvider>
  );
};

export default App;
