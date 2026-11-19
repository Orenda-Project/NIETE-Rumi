import { useSearchParams } from 'react-router-dom';

/** The view's place in the address, so Back and the phone's back button work: ?jstep=<rung>[&jteacher=<id>]. */
export const STEP_PARAM = 'jstep';
export const TEACHER_PARAM = 'jteacher';

/** The current address with some of the view's params set (a value) or removed (null). */
export function useJourneyLink() {
  const [params] = useSearchParams();
  return (patch: Record<string, string | null>) => {
    const q = new URLSearchParams(params);
    Object.entries(patch).forEach(([k, v]) => (v === null ? q.delete(k) : q.set(k, v)));
    const s = q.toString();
    return s ? `?${s}` : '?';
  };
}
