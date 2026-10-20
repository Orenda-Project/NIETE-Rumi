/**
 * The "Reading Hour & Numeracy" band's door on the New-lesson page. NewLessonPage loads with the
 * teacher app's first screen, so this file stays tiny: it asks GET /fln/me and only when lessons are on does it load
 * the band itself (FlnBandBody + its CSS) as a separate chunk. Off, pending, 404 or any failure → null, so the page is
 * byte-identical to today and no teacher downloads FLN code while the switch is off.
 *
 * Whether a TEACHER sees the band at all is the body's call, once their classes are read (bd-4tsjcr: a teacher whose
 * every known grade is above 5 sees none). A leader always sees it: the role comes from /fln/me, which re-reads
 * `users.role` on every request.
 */
import { lazy, Suspense, useEffect, useState } from 'react';
import { flnApi } from './api';
import { isLeader } from '../lib/leaderRole';

const FlnBandBody = lazy(() => import('./FlnBandBody').then((m) => ({ default: m.FlnBandBody })));

/** null = no band; otherwise whether the viewer is in the school-leader family. */
type Door = null | { leader: boolean };

export function FlnBand() {
  const [door, setDoor] = useState<Door>(null);
  useEffect(() => {
    let live = true;
    flnApi.me().then(
      (m) => { if (live) setDoor(m && m.lessons ? { leader: isLeader(m) } : null); },
      () => { if (live) setDoor(null); },
    );
    return () => { live = false; };
  }, []);
  if (!door) return null;
  return (
    <Suspense fallback={null}>
      <FlnBandBody leader={door.leader} />
    </Suspense>
  );
}
