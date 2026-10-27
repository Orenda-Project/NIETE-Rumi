import { lazy, Suspense } from "react";
import { Route, Routes } from "react-router-dom";
import RmGate, { RmNotAvailable } from "./RmGate";

/**
 * bd-sex15q.17 — the RM pages, mounted once in App.tsx at `/portal/rm/*`, all behind RmGate (GET /coachip/me → rm). With
 * no portal_coachip_rm entry for this user nothing here renders and no RM read fires (B7, B8). Never under CoachGate.
 */
const RmHome = lazy(() => import("./pages/RmHome"));
const RmCoaches = lazy(() => import("./pages/RmCoaches"));
const RmCoach = lazy(() => import("./pages/RmCoach"));
const RmCircle = lazy(() => import("./pages/RmCircle"));
const RmStats = lazy(() => import("./pages/RmStats"));

export default function RmRoutes() {
  return (
    <RmGate>
      <Suspense fallback={null}>
        <Routes>
          <Route index element={<RmHome />} />
          <Route path="coaches" element={<RmCoaches />} />
          <Route path="coach/:coachUserId" element={<RmCoach />} />
          <Route path="circle" element={<RmCircle />} />
          <Route path="stats" element={<RmStats />} />
          <Route path="*" element={<RmNotAvailable />} />
        </Routes>
      </Suspense>
    </RmGate>
  );
}
