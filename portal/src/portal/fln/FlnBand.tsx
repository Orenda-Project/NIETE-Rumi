/**
 * bd-t7zk3t.11 — the "Reading Hour & Numeracy" band's door on the New-lesson page. NewLessonPage loads with the
 * teacher app's first screen, so this file stays tiny: it asks GET /fln/me and only when lessons are on does it load
 * the band itself (FlnBandBody + its CSS) as a separate chunk. Off, pending, 404 or any failure → null, so the page is
 * byte-identical to today and no teacher downloads FLN code while the switch is off.
 */
import { lazy, Suspense, useEffect, useState } from 'react';
import { flnApi } from './api';

const FlnBandBody = lazy(() => import('./FlnBandBody').then((m) => ({ default: m.FlnBandBody })));

export function FlnBand() {
  const [on, setOn] = useState(false);
  useEffect(() => {
    let live = true;
    flnApi.me().then(
      (m) => { if (live) setOn(!!(m && m.lessons)); },
      () => { if (live) setOn(false); },
    );
    return () => { live = false; };
  }, []);
  if (!on) return null;
  return (
    <Suspense fallback={null}>
      <FlnBandBody />
    </Suspense>
  );
}
