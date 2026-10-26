import { lazy, Suspense } from "react";
import { Route, Routes } from "react-router-dom";

/**
 * bd-sex15q.15 — the coach insight pages, mounted once in App.tsx at `/portal/coach/insights/*`. Every page gates itself
 * (InsightsGate: a v2 coach with portal_coachip); with the switch off nothing here renders (B7).
 */
const ThisWeek = lazy(() => import("./pages/ThisWeek"));
const Weakness = lazy(() => import("./pages/Weakness"));
const Where = lazy(() => import("./pages/Where"));
const Move = lazy(() => import("./pages/Move"));
const Schools = lazy(() => import("./pages/Schools"));
const Listen = lazy(() => import("./pages/Listen"));
const Stats = lazy(() => import("./pages/Stats"));
const Results = lazy(() => import("./pages/Results"));
const MomentRoute = lazy(() => import("./pages/MomentRoute"));

export default function InsightsRoutes() {
  return (
    <Suspense fallback={null}>
      <Routes>
        <Route index element={<ThisWeek />} />
        <Route path="w/:wId" element={<Weakness />} />
        <Route path="w/:wId/where" element={<Where />} />
        <Route path="w/:wId/move" element={<Move />} />
        <Route path="m/:momentId" element={<MomentRoute />} />
        <Route path="schools" element={<Schools />} />
        <Route path="listen" element={<Listen />} />
        <Route path="stats" element={<Stats />} />
        <Route path="stats/results" element={<Results />} />
        <Route path="*" element={<ThisWeek />} />
      </Routes>
    </Suspense>
  );
}
