import { useEffect, useRef, useState } from 'react';
import { BookOpen, Camera, CircleAlert, FileText, Library } from 'lucide-react';
import { acceptFor } from '../../lib/coachingUpload';
import type { LessonPlanUsed } from '../home/progressApi';
import { Sheet } from '../Sheet';
import { List, Row, SectionLabel } from '../List';
import { Chip } from '../Chip';
import { getRecentPlans, pickOf, planChips } from './coachingApi';
import type { Picked } from './LibraryStep';
import { PICKER_WORDS_EN, type PickerWords } from './pickerWords';

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
 *
 * `words`: the teacher v2's translation of the picker's words (bd-fmf24g.13); English when left out.
 */

export function PlanSheet({ open, onClose, onPick, onLibrary, onFile, problem, words }: {
  open: boolean;
  onClose: () => void;
  onPick: (plan: Picked) => void;
  onLibrary: () => void;
  /** A photo or a file of her own plan; true when it was a lesson plan (the sheet then closes). */
  onFile: (file: File | undefined, asPhoto: boolean) => boolean;
  problem: 'not_a_plan' | null;
  words?: PickerWords;
}) {
  const W = words ?? PICKER_WORDS_EN;
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
    <Sheet open={open} title={W.lessonPlan} onClose={onClose} testId="coaching-plan-sheet">
      {recent.length ? (
        <>
          <SectionLabel>{W.recent}</SectionLabel>
          <List label={W.recent}>
            {recent.map((p) => (
              <Row
                key={p.planKey}
                title={p.title || W.planFallback}
                icon={BookOpen}
                chips={planChips(p, W).map((c) => <Chip key={c}>{c}</Chip>)}
                onClick={() => onPick({ pick: pickOf(p), title: p.title || W.planFallback, chips: planChips(p, W) })}
              />
            ))}
          </List>
        </>
      ) : null}
      <List>
        <Row title={W.fromLibrary} icon={Library} onClick={onLibrary} />
        <Row title={W.takePhoto} icon={Camera} onClick={() => photo.current?.click()} />
        <Row title={W.chooseFile} icon={FileText} onClick={() => fileInput.current?.click()} />
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
        <div className="flex justify-center"><Chip tone="error" icon={CircleAlert}>{W.notAPlan}</Chip></div>
      ) : null}
    </Sheet>
  );
}
