import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import Index from "./pages/Index";
import HowItWorks from "./pages/HowItWorks";
import NotFound from "./pages/NotFound";
import PortalSetup from "./portal/pages/PortalSetup";
import PortalLogin from "./portal/pages/PortalLogin";
import PortalPasswordReset from "./portal/pages/PortalPasswordReset";
import PortalPasswordResetVerify from "./portal/pages/PortalPasswordResetVerify";
import PortalDashboard from "./portal/pages/PortalDashboard";
import PortalLessonPlans from "./portal/pages/PortalLessonPlans";
import PortalCurriculum from "./portal/pages/PortalCurriculum";
import PortalTraining from "./portal/pages/PortalTraining";
import PortalCoaching from "./portal/pages/PortalCoaching";
import PortalCoachingAnalytics from "./portal/pages/PortalCoachingAnalytics";
import PortalCoachingDetail from "./portal/pages/PortalCoachingDetail";
/* Reading assessments + video library are not part of NIETE's launch scope. Routes + imports
 * removed so the URLs 404 rather than expose unfinished screens. Restore by re-adding both
 * imports and the /portal/reading-* + /portal/video* routes below. */

const queryClient = new QueryClient();

const App = () => {
  const { i18n } = useTranslation();
  const isPortalSubdomain = window.location.hostname.startsWith('portal.');

  useEffect(() => {
    // Update the lang attribute on the HTML element
    const currentLang = i18n.language;
    document.documentElement.setAttribute('lang', currentLang);

    // Set direction for RTL languages
    if (currentLang === 'ar' || currentLang === 'ur') {
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
            <Route path="/" element={isPortalSubdomain ? <PortalLogin /> : <Index />} />
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

            {/* ADD ALL CUSTOM ROUTES ABOVE THE CATCH-ALL "*" ROUTE */}
            <Route path="*" element={<NotFound />} />
          </Routes>
        </BrowserRouter>
      </TooltipProvider>
    </QueryClientProvider>
  );
};

export default App;
