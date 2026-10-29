import { Navigate, useLocation, useParams } from "react-router-dom";
import { CardOnly } from "./frame";

/**
 * The old addresses of her coaching data, now ONE Coaching page: "Her coaching reports" (/reports) and her separate DC and
 * coach-visit lists (/items/dc, /items/coach). Each opens the Coaching page with the same period, and a list opens it with
 * its filter picked, so a saved link or Back never lands on Not found. With the switch off they are Not found, as before.
 */
function ToCoaching() {
  const { ext = "" } = useParams();
  const { pathname, search } = useLocation();
  const params = new URLSearchParams(search);
  const next = new URLSearchParams();
  const period = params.get("period");
  if (period) next.set("period", period);
  if (/\/items\/dc\/?$/.test(pathname)) next.set("show", "dc");
  if (/\/items\/coach\/?$/.test(pathname)) next.set("show", "coach");
  const qs = next.toString();
  return <Navigate replace to={`/portal/coach/teacher/${encodeURIComponent(ext)}/coaching${qs ? `?${qs}` : ""}`} />;
}

export default function CoachingRedirect() {
  return <CardOnly><ToCoaching /></CardOnly>;
}
