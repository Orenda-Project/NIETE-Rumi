import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route } from "react-router-dom";
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
import PortalDashboard from "./portal/pages/PortalDashboard";
import PortalLessonPlans from "./portal/pages/PortalLessonPlans";
import PortalCurriculum from "./portal/pages/PortalCurriculum";
import PortalTraining from "./portal/pages/PortalTraining";
import PortalCoaching from "./portal/pages/PortalCoaching";
import PortalCoachingAnalytics from "./portal/pages/PortalCoachingAnalytics";
import PortalCoachingDetail from "./portal/pages/PortalCoachingDetail";
import LeaderHome from "./portal/pages/LeaderHome";
import LeaderTeachers from "./portal/pages/LeaderTeachers";
import LeaderTeacherDetail from "./portal/pages/LeaderTeacherDetail";
import LeaderObservations from "./portal/pages/LeaderObservations";
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
          <Route path="/portal/dashboard" element={<PortalDashboard />} />
            <Route path="/portal/lesson-plans" element={<PortalLessonPlans />} />
            <Route path="/portal/curriculum" element={<PortalCurriculum />} />
            <Route path="/portal/training" element={<PortalTraining />} />
            <Route path="/portal/coaching" element={<PortalCoaching />} />
            <Route path="/portal/coaching/analytics" element={<PortalCoachingAnalytics />} />
            <Route path="/portal/coaching/session/:sessionId" element={<PortalCoachingDetail />} />

            {/* Leader Portal (bd-2434) — role-gated inside the pages; the leader
                nav + My Patch only render for the school-leader family. */}
            <Route path="/portal/leader" element={<LeaderHome />} />
            <Route path="/portal/leader/teachers" element={<LeaderTeachers />} />
            <Route path="/portal/leader/observations" element={<LeaderObservations />} />
            <Route path="/portal/leader/teacher/:id" element={<LeaderTeacherDetail />} />

            {/* ADD ALL CUSTOM ROUTES ABOVE THE CATCH-ALL "*" ROUTE */}
            <Route path="*" element={<NotFound />} />
          </Routes>
        </BrowserRouter>
      </TooltipProvider>
    </QueryClientProvider>
  );
};

export default App;
