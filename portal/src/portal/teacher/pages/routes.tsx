import type { TeacherRoute } from "../routes";
import { featurePath } from "../paths";
import Home from "./Home";
import More from "./More";
import Profile from "./Profile";

/** bd-fmf24g.1 — the frame's own pages: Home, More, My profile (see teacher/routes.tsx). */
const routes: TeacherRoute[] = [
  { path: featurePath("home"), element: <Home /> },
  { path: featurePath("more"), element: <More /> },
  { path: featurePath("profile"), element: <Profile /> },
];

export default routes;
