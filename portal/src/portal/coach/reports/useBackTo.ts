import { useLocation, useNavigate } from "react-router-dom";

/**
 * bd-4404s7.5 — Back: one step back when she came from another page of the app, else to a sensible page (opened cold
 * from a link, Back must still go somewhere).
 */
export function useBackTo(fallback: string): () => void {
  const navigate = useNavigate();
  const location = useLocation();
  return () => (location.key && location.key !== "default" ? navigate(-1) : navigate(fallback));
}
