import { Navigate, useLocation, useParams } from "react-router-dom";
import { CardOnly } from "./frame";

/**
 * Old addresses of her coaching data, all now her Digital Coaching or Coach observations page (design v9): "Her coaching
 * reports" (/reports), her DC and coach-visit lists (/items/dc, /items/coach) and option A's page (/coaching, ?show=).
 * Each keeps the period, so a saved link or Back never lands on Not found. With the switch off they are Not found.
 */
function ToHerPage() {
  const { ext = "" } = useParams();
  const { pathname, search } = useLocation();
  const params = new URLSearchParams(search);
  const coach = /\/items\/coach\/?$/.test(pathname) || (/\/coaching\/?$/.test(pathname) && params.get("show") === "coach");
  const next = new URLSearchParams();
  const period = params.get("period");
  if (period) next.set("period", period);
  const qs = next.toString();
  return <Navigate replace to={`/portal/coach/teacher/${encodeURIComponent(ext)}/${coach ? "observations" : "dc"}${qs ? `?${qs}` : ""}`} />;
}

export default function CoachingRedirect() {
  return <CardOnly><ToHerPage /></CardOnly>;
}
