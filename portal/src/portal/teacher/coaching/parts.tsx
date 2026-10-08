import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { BookOpen, Camera, ChevronDown, ImageIcon, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { acceptFor, checkFile, MAX_PHOTOS } from '../../lib/coachingUpload';
import { ListRow } from '../ui';
import { FOCUS, GRID } from '../ui/styles';
import { useCopy } from '../i18n';
import { COACHING } from './copy';
import type { DraftPlan } from './draft';

/**
 * bd-fmf24g.4 — the pieces the hub and Check and send share (v28 canvas Coaching / CoachingCheck).
 */

/** A section's light 20px heading, with an optional small chip ("Optional", "No faces"). */
export function SectionHeading({ children, chip }: { children: ReactNode; chip?: string }) {
  return (
    <h2 className="mx-1 mt-3 flex items-center gap-2 text-[20px] font-light text-[#1d2025]">
      {children}
      {chip ? (
        <span className="inline-flex h-[26px] items-center rounded-full bg-[#e5e7eb] px-2.5 text-[12px] font-semibold text-[#374151]">{chip}</span>
      ) : null}
    </h2>
  );
}

/** The lesson plan: a "Select lesson plan" trigger, or the chosen plan as a row with Change. */
export function PlanPicker({ plan, disabled, onOpen }: { plan: DraftPlan | null; disabled?: boolean; onOpen: () => void }) {
  const C = useCopy(COACHING);
  if (plan) {
    const label = plan.kind === 'library' ? plan.title : C.planPhoto;
    const subtitle = plan.kind === 'library' ? plan.chips.join(' · ') : plan.file.name;
    return (
      <ListRow
        icon="file"
        label={label}
        subtitle={subtitle || undefined}
        chip={{ text: C.change, tone: 'score' }}
        onPress={onOpen}
      />
    );
  }
  return (
    <button
      type="button"
      disabled={disabled}
      aria-haspopup="dialog"
      onClick={onOpen}
      className={cn(
        'flex min-h-[76px] w-full items-center gap-3 rounded-2xl border border-[#e5e7eb] bg-white px-3 py-2.5 text-start shadow-[0_1px_3px_rgba(16,24,40,0.08)]',
        disabled && 'opacity-45 shadow-none',
        FOCUS,
      )}
    >
      <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-[#f3f4f6] text-[#33374a]">
        <BookOpen className="h-[22px] w-[22px]" aria-hidden="true" />
      </span>
      <span className="min-w-0 flex-1 text-[17px] font-semibold leading-snug">{C.selectPlan}</span>
      <ChevronDown className="h-[22px] w-[22px] shrink-0 text-[#6b7280]" strokeWidth={2.4} aria-hidden="true" />
    </button>
  );
}

/** Each photo's preview url, made once per File and released with it. */
function usePreviews(files: File[]): (string | null)[] {
  const urls = useMemo(() => files.map((f) => {
    try { return URL.createObjectURL(f); } catch { return null; }
  }), [files]);
  useEffect(() => () => { urls.forEach((u) => { if (u) URL.revokeObjectURL(u); }); }, [urls]);
  return urls;
}

export type PhotosProblem = 'too_many' | 'not_a_photo' | null;

/** One grid of photos (at most MAX_PHOTOS), each removable, and Add photo while there is room. */
export function PhotoGrid({ photos, onChange, testId }: { photos: File[]; onChange: (next: File[]) => void; testId: string }) {
  const C = useCopy(COACHING);
  const input = useRef<HTMLInputElement>(null);
  const [problem, setProblem] = useState<PhotosProblem>(null);
  const previews = usePreviews(photos);

  const add = (list: FileList | null) => {
    setProblem(null);
    const chosen = Array.from(list || []);
    if (!chosen.length) return;
    if (chosen.some((f) => checkFile(f, 'photo'))) { setProblem('not_a_photo'); return; }
    if (photos.length + chosen.length > MAX_PHOTOS) { setProblem('too_many'); return; }
    onChange([...photos, ...chosen]);
  };

  return (
    <>
      <div className={cn(GRID, 'grid-cols-3 gap-2.5')}>
        {photos.map((f, i) => (
          <div key={`${f.name}-${i}`} className="relative aspect-square overflow-hidden rounded-[14px] bg-[#dfe3e8] text-[#6b7280]">
            {previews[i]
              ? <img src={previews[i] as string} alt={f.name} className="h-full w-full object-cover" />
              : <span className="flex h-full w-full items-center justify-center"><ImageIcon className="h-7 w-7" aria-hidden="true" /></span>}
            <button
              type="button"
              aria-label={C.removePhoto(i + 1)}
              onClick={() => { setProblem(null); onChange(photos.filter((_, j) => j !== i)); }}
              className={cn('absolute end-0 top-0 flex h-14 w-14 items-start justify-end p-1', FOCUS)}
            >
              <span className="flex h-[34px] w-[34px] items-center justify-center rounded-full border border-[#e5e7eb] bg-white/95 text-[#33374a]">
                <X className="h-4 w-4" strokeWidth={2.6} aria-hidden="true" />
              </span>
            </button>
          </div>
        ))}
        {photos.length < MAX_PHOTOS ? (
          <button
            type="button"
            onClick={() => input.current?.click()}
            className={cn('flex aspect-square min-h-[56px] flex-col items-center justify-center gap-1.5 rounded-[14px] border-[1.5px] border-dashed border-[#c7cad6] bg-white text-[14px] font-semibold text-[#33374a]', FOCUS)}
          >
            <Camera className="h-[26px] w-[26px]" aria-hidden="true" />
            {C.addPhoto}
          </button>
        ) : null}
      </div>
      <input
        ref={input}
        hidden
        type="file"
        multiple
        data-testid={testId}
        accept={`${acceptFor('photo')},image/jpeg,image/png`}
        onChange={(e) => { add(e.target.files); e.target.value = ''; }}
      />
      {problem ? (
        <p role="alert" className="mx-1 text-[14px] font-semibold text-[#c8331f]">{problem === 'too_many' ? C.upToThree : C.notAPhoto}</p>
      ) : null}
    </>
  );
}
