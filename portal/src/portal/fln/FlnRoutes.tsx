/**
 * The FLN pages' route table, relative to `/portal/fln/*` (App.tsx mounts it with ONE hook line).
 * Every page is behind FlnGate (sign-in with next=, the feature switch, the FLN context).
 *
 *   p/:id                    the plan (PlanPage, worker `plan`)
 *   list/:subject?grade=     grades 1–5 → the level's list (FLN is Grades 1–5 only, bd-elc1qz)
 *   list/:subject?grade=&level=   that level's list
 *   list/:subject?grade=6..12     an old link from when 6–12 had a level chooser → replaced by the level's Grade 1–5
 *                            list (`&level=n`), else Grade 1
 *   *                        "This lesson isn't available"
 *
 * Routes are listed explicitly — no glob loading (a route that silently fails to load is a page that silently
 * disappears).
 */
import { Navigate, Route, Routes, useParams, useSearchParams } from 'react-router-dom';
import { FlnGate, FlnNotAvailable } from './FlnGate';
import { useFln } from './FlnContext';
import { LessonList } from './LessonList';
import { LEVEL_GRADE, isFlnSubject, listUrl } from './listShared';
import PlanPage from './PlanPage';
import SendPage from './send/SendPage';

const intIn = (v: string | null, lo: number, hi: number): number | null => {
  if (v == null || !/^\d{1,2}$/.test(v)) return null;
  const n = Number(v);
  return n >= lo && n <= hi ? n : null;
};

function NotFound() {
  const { lang } = useFln();
  return <FlnNotAvailable lang={lang} />;
}

/** list/:subject?grade=<1..5>[&level=<1..3>]; an old grade 6–12 link is replaced, never served. */
export function ListRoute() {
  const { subject } = useParams();
  const [q] = useSearchParams();
  const grade = intIn(q.get('grade'), 1, 12);
  const level = intIn(q.get('level'), 1, 3);
  if (!isFlnSubject(subject) || grade == null) return <NotFound />;
  if (grade >= 6) return <Navigate replace to={listUrl(subject, level ? LEVEL_GRADE[level as 1 | 2 | 3] : 1)} />;
  return <LessonList key={`${subject}|${grade}|${level ?? ''}`} subject={subject} grade={grade} level={level} />;
}

export default function FlnRoutes() {
  return (
    <FlnGate>
      <Routes>
        <Route path="p/:id" element={<PlanPage />} />
        <Route path="list/:subject" element={<ListRoute />} />
        <Route path="send" element={<SendPage />} />
        <Route path="*" element={<NotFound />} />
      </Routes>
    </FlnGate>
  );
}
