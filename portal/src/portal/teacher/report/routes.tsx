import type { TeacherRoute } from "../routes";
import { lazyPage as page } from "@/lib/lazyPage";
import { TEACHER_REPORT_PATH } from "./paths";

/** bd-370733 — More → Report an issue, the coach's form for teachers too (operator, 12 Nov: "Should be for teacher as well"). */
const TeacherReport = page(() => import("./TeacherReport"));

const routes: TeacherRoute[] = [{ path: TEACHER_REPORT_PATH, element: <TeacherReport /> }];
export default routes;
