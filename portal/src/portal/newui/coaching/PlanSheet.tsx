import { useEffect, useRef, useState } from 'react';
import { BookOpen, Camera, CircleAlert, FileText, Library } from 'lucide-react';
import { acceptFor } from '../../lib/coachingUpload';
import type { LessonPlanUsed } from '../home/progressApi';
import { COACHING_COPY } from '../copy';
import { Sheet } from '../Sheet';
import { List, Row, SectionLabel } from '../List';
import { Chip } from '../Chip';
import { getRecentPlans, pickOf, planChips } from './coachingApi';
import type { Picked } from './LibraryStep';

/**
 * bd-5rz1v.26 — Check and send's "Lesson plan" sheet.
 *
 *   Recent lesson plans   her last three (GET /lesson-plans/recent, bd-5rz1v.15): one tap picks
 *                         one. Most teachers taught from one of these.
 *   From the library      the library, one step at a time (LibraryStep)
 *   Take a photo          of her own written plan: the back camera. `accept` must be exactly
 *                         image/* — Capacitor opens the camera only then. Checked on arrival.
 *   Choose a file         a PDF, Word file or photo
 *
 * Both pickers open from the tap (a hidden input), never later.
 */

export function PlanSheet({ open, onClose, onPick, onLibrary, onFile, problem }: {
  open: boolean;
  onClose: () => void;
  onPick: (plan: Picked) => void;
  onLibrary: () => void;
  /** A photo or a file of her own plan; true when it was a lesson plan (the sheet then closes). */
  onFile: (file: File | undefined, asPhoto: boolean) => boolean;
  problem: 'not_a_plan' | null;
}) {
  const [recent, setRecent] = useState<LessonPlanUsed[]>([]);
  const photo = useRef<HTMLInputElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return undefined;
    let live = true;
    getRecentPlans(3).then((plans) => { if (live) setRecent(plans); });
    return () => { live = false; };
  }, [open]);

  const chosen = (file: File | undefined, asPhoto: boolean) => { if (onFile(file, asPhoto)) onClose(); };

  return (
    <Sheet open={open} title={COACHING_COPY.lessonPlan} onClose={onClose} testId="coaching-plan-sheet">
      {recent.length ? (
        <>
          <SectionLabel>{COACHING_COPY.recent}</SectionLabel>
          <List label={COACHING_COPY.recent}>
            {recent.map((p) => (
              <Row
                key={p.planKey}
                title={p.title || COACHING_COPY.planFallback}
                icon={BookOpen}
                chips={planChips(p).map((c) => <Chip key={c}>{c}</Chip>)}
                onClick={() => onPick({ pick: pickOf(p), title: p.title || COACHING_COPY.planFallback, chips: planChips(p) })}
              />
            ))}
          </List>
        </>
      ) : null}
      <List>
        <Row title={COACHING_COPY.fromLibrary} icon={Library} onClick={onLibrary} />
        <Row title={COACHING_COPY.takePhoto} icon={Camera} onClick={() => photo.current?.click()} />
        <Row title={COACHING_COPY.chooseFile} icon={FileText} onClick={() => fileInput.current?.click()} />
      </List>
      <input
        ref={photo}
        hidden
        type="file"
        accept="image/*"
        capture="environment"
        data-testid="plan-photo-input"
        onChange={(e) => { chosen(e.target.files?.[0], true); e.target.value = ''; }}
      />
      <input
        ref={fileInput}
        hidden
        type="file"
        accept={acceptFor('lesson_plan')}
        data-testid="plan-file-input"
        onChange={(e) => { chosen(e.target.files?.[0], false); e.target.value = ''; }}
      />
      {problem ? (
        <div className="flex justify-center"><Chip tone="error" icon={CircleAlert}>{COACHING_COPY.notAPlan}</Chip></div>
      ) : null}
    </Sheet>
  );
}
