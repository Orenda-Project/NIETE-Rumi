import type { TeacherRoute } from "../routes";
import { featurePath } from "../paths";
import { lazyPage as page } from "@/lib/lazyPage";

// bd-sex15q.34 — each page is its own chunk (lib/lazyPage), so the teacher app is not in every first open.
const Home = page(() => import("./Home"));
const More = page(() => import("./More"));
const Profile = page(() => import("./Profile"));

/** bd-fmf24g.1 — the frame's own pages: Home, More, My profile (see teacher/routes.tsx). */
const routes: TeacherRoute[] = [
  { path: featurePath("home"), element: <Home /> },
  { path: featurePath("more"), element: <More /> },
  { path: featurePath("profile"), element: <Profile /> },
];

export default routes;
