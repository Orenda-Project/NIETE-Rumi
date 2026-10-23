import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { BookOpen, Camera, Check, ChevronDown, Eye, ImageIcon, Pause, Play, RotateCcw, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { acceptFor, checkFile, MAX_PHOTOS } from '../../lib/coachingUpload';
import { AttentionBanner, ListRow } from '../ui';
import { CARD, FOCUS, GRID } from '../ui/styles';
import { useCopy } from '../i18n';
import { LESSONS } from '../lessons/copy';
import { dayName, pkDayOf, pkToday } from '../lessons/days';
import type { PendingRecording } from './api';
import { COACHING } from './copy';
import { isSavedAudio, type DcAudio, type DraftPlan } from './draft';
import { lessonPath } from './paths';

/**
 * bd-fmf24g.4 — the pieces the Digital Coaching page and the recording page share (v28 canvas Coaching / CoachingCheck).
 */

/** A section's light 20px heading, with an optional small chip ("Optional", "No faces"). */
export function SectionHeading({ children, chip }: { children: ReactNode; chip?: string | readonly string[] }) {
  // bd-4404s7.4 — the coach's Photos heading carries two ("Up to 3", "No faces"); one string is as before.
  const chips = (typeof chip === 'string' ? [chip] : chip ?? []).filter(Boolean);
  return (
    <h2 className="mx-1 mt-3 flex flex-wrap items-center gap-2 text-[20px] font-light text-[#1d2025]">
      {children}
      {chips.map((c) => (
        <span key={c} className="inline-flex h-[26px] items-center rounded-full bg-[#e5e7eb] px-2.5 text-[12px] font-semibold text-[#374151]">{c}</span>
      ))}
    </h2>
  );
}

/**
 * The lesson plan: a "Select lesson plan" trigger, or the chosen plan as a row with Change, and (bd-fgj73x.5) an eye beside
 * a library plan that opens it to read (`onView`). `readOnly` (bd-fgj73x.6, while she records): the plan stays in sight, no
 * Change; the row and the eye open it to read.
 */
export function PlanPicker({ plan, disabled, onOpen, onView, readOnly = false }: {
  plan: DraftPlan | null; disabled?: boolean; onOpen: () => void; onView?: () => void; readOnly?: boolean;
}) {
  const C = useCopy(COACHING);
  if (plan) {
    // bd-hsgah5: an uploaded plan may be a PDF, a Word file or a photo — it is the lesson plan, its name under it.
    const label = plan.kind === 'library' ? plan.title : C.lessonPlan;
    const subtitle = plan.kind === 'library' ? plan.chips.join(' · ') : plan.file.name;
    const row = (
      <ListRow
        className={onView ? 'min-w-0 flex-1' : undefined}
        icon="file"
        label={label}
        subtitle={subtitle || undefined}
        chip={readOnly ? null : { text: C.change, tone: 'score' }}
        onPress={readOnly ? onView : onOpen}
      />
    );
    if (!onView) return row;
    return (
      <div className="flex items-center gap-2">
        {row}
        <button
          type="button"
          aria-label={C.viewPlan}
          onClick={onView}
          className={cn('flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl border-[1.5px] border-[#c7cad6] bg-white text-[#33374a]', FOCUS)}
        >
          <Eye className="h-[22px] w-[22px]" strokeWidth={2} aria-hidden="true" />
        </button>
      </div>
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

const ADD_TILE = cn('flex aspect-square min-h-[56px] flex-col items-center justify-center gap-1.5 rounded-[14px] border-[1.5px] border-dashed border-[#c7cad6] bg-white text-center text-[14px] font-semibold text-[#33374a]', FOCUS);

/**
 * One grid of photos, each removable, and Add photo while there is room: at most `max` (the coach's three by default;
 * the teacher's Digital Coaching passes ten, DC_MAX_PHOTOS).
 *
 * bd-rt8wky — `camera` (the teacher's Digital Coaching): Add photo becomes two tiles, Take photo (the phone camera,
 * one photo a tap; in the Android app Capacitor hands it to the camera app) and From gallery (one or several), and a
 * count under the grid. The coach's grid passes no `camera` and is unchanged.
 */
export function PhotoGrid({ photos, onChange, testId, max = MAX_PHOTOS, camera = false }: {
  photos: File[]; onChange: (next: File[]) => void; testId: string; max?: number; camera?: boolean;
}) {
  const C = useCopy(COACHING);
  const input = useRef<HTMLInputElement>(null);
  const cameraInput = useRef<HTMLInputElement>(null);
  const [problem, setProblem] = useState<PhotosProblem>(null);
  const previews = usePreviews(photos);

  const add = (list: FileList | null) => {
    setProblem(null);
    const chosen = Array.from(list || []);
    if (!chosen.length) return;
    if (chosen.some((f) => checkFile(f, 'photo'))) { setProblem('not_a_photo'); return; }
    if (photos.length + chosen.length > max) { setProblem('too_many'); return; }
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
        {photos.length < max && camera ? (
          <>
            <button type="button" onClick={() => cameraInput.current?.click()} className={ADD_TILE}>
              <Camera className="h-[26px] w-[26px]" aria-hidden="true" />
              {C.takePhoto}
            </button>
            <button type="button" onClick={() => input.current?.click()} className={ADD_TILE}>
              <ImageIcon className="h-[26px] w-[26px]" aria-hidden="true" />
              {C.fromGallery}
            </button>
          </>
        ) : photos.length < max ? (
          <button type="button" onClick={() => input.current?.click()} className={ADD_TILE}>
            <Camera className="h-[26px] w-[26px]" aria-hidden="true" />
            {C.addPhoto}
          </button>
        ) : null}
      </div>
      {camera && photos.length ? <p className="mx-1 text-[14px] text-[#6b7280]">{C.photoCount(photos.length, max)}</p> : null}
      {camera ? (
        <input
          ref={cameraInput}
          hidden
          type="file"
          capture="environment"
          data-testid={`${testId}-camera`}
          // accept must carry image/*: the Android app (Capacitor) opens the camera only then, and any
          // other list gets the gallery. add() still checks the type on arrival.
          accept="image/*"
          onChange={(e) => { add(e.target.files); e.target.value = ''; }}
        />
      ) : null}
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
        <p role="alert" className="mx-1 text-[14px] font-semibold text-[#c8331f]">{problem === 'too_many' ? C.upToPhotos(max) : C.notAPhoto}</p>
      ) : null}
    </>
  );
}

/** A row of the page's bottom actions (the dock). */
export function Dock({ children }: { children: ReactNode }) {
  return <div className="flex w-full gap-2.5">{children}</div>;
}

/** One 56px action: the page's primary (indigo), an outline, or the red Stop. A `to` makes it a link (with `state`). */
export function Action({ children, onClick, to, state, tone = 'primary', icon: Icon, disabled }: {
  children: ReactNode; onClick?: () => void; to?: string; state?: unknown; tone?: 'primary' | 'outline' | 'danger';
  icon?: typeof Play; disabled?: boolean;
}) {
  const cls = cn(
    'flex h-14 flex-1 items-center justify-center gap-2 rounded-2xl border-[1.5px] text-[16px] font-semibold',
    tone === 'primary' && 'border-[#33374a] bg-[#33374a] text-white',
    tone === 'danger' && 'border-[#c8331f] bg-[#c8331f] text-white',
    tone === 'outline' && 'border-[#c7cad6] bg-white text-[#33374a]',
    disabled && 'pointer-events-none border-[#e5e7eb] bg-[#e5e7eb] text-[#6b7280]',
    FOCUS,
  );
  const body = <>{Icon ? <Icon className="h-5 w-5" aria-hidden="true" /> : null}{children}</>;
  return to
    ? <Link to={to} state={state} className={cls}>{body}</Link>
    : <button type="button" onClick={onClick} disabled={disabled} className={cls}>{body}</button>;
}

const minutesOf = (ms: number | null) => (ms != null ? Math.max(1, Math.round(ms / 60_000)) : null);

/**
 * bd-fmf24g.76 — her recording as attached to the Digital Coaching page: Listen to it, and Redo (one made here: it is
 * deleted from the phone and she records again) or Change file (one she uploaded: the picker opens). It plays from a url
 * made once per recording and released with it.
 */
export function RecordingCard({ audio, onRedo, onChangeFile }: { audio: DcAudio; onRedo: () => void; onChangeFile: () => void }) {
  const C = useCopy(COACHING);
  const player = useRef<HTMLAudioElement | null>(null);
  const [playing, setPlaying] = useState(false);
  const [url, setUrl] = useState<string | null>(null);
  // bd-c5reix: her recording kept from WhatsApp is listened to through its link; Change lets go of it.
  const saved = isSavedAudio(audio);
  useEffect(() => {
    setPlaying(false);
    if (isSavedAudio(audio)) { setUrl(audio.listenUrl); return undefined; }
    let made: string | null = null;
    try { made = URL.createObjectURL(audio.blob); } catch { made = null; }
    setUrl(made);
    return () => { if (made) URL.revokeObjectURL(made); };
  }, [audio]);
  const toggle = () => {
    const el = player.current;
    if (!el) return;
    try {
      if (playing) { el.pause(); setPlaying(false); } else { void el.play()?.catch(() => setPlaying(false)); setPlaying(true); }
    } catch {
      setPlaying(false);
    }
  };
  const minutes = minutesOf(audio.durationMs);
  const recordedHere = saved || !!audio.recordingId;
  return (
    <section aria-label={C.yourRecording} data-testid="dc-recording" className={cn(CARD, 'flex min-h-[84px] items-center gap-3 p-3')}>
      <button
        type="button"
        onClick={toggle}
        disabled={!url}
        aria-label={playing ? C.stopListening : C.listen}
        className={cn('flex h-14 w-14 shrink-0 items-center justify-center rounded-full border-[2.5px] border-[#2f7a52] bg-white text-[#2f7a52]', FOCUS)}
      >
        {playing ? <Pause className="h-[22px] w-[22px]" aria-hidden="true" /> : <Play className="h-[22px] w-[22px] rtl:rotate-180" aria-hidden="true" />}
      </button>
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="truncate text-[16px] font-semibold">{saved ? C.fromWhatsApp : audio.source === 'file' ? audio.filename : C.yourRecording}</span>
        {minutes != null ? <span className="text-[13px] text-[#6b7280]">{C.minutes(minutes)}</span> : null}
      </span>
      <button
        type="button"
        onClick={() => { setPlaying(false); (recordedHere ? onRedo : onChangeFile)(); }}
        className={cn('flex min-h-14 items-center gap-1.5 rounded-xl bg-[#f3f4f6] px-3.5 text-[14px] font-semibold text-[#33374a]', FOCUS)}
      >
        <RotateCcw className="h-4 w-4" aria-hidden="true" />
        {saved ? C.change : recordedHere ? C.redo : C.changeFile}
      </button>
      {url ? <audio ref={player} src={url} preload="metadata" onEnded={() => setPlaying(false)} className="hidden" /> : null}
    </section>
  );
}

/**
 * bd-c5reix — a classroom recording she sent on WhatsApp, kept and waiting for her: the kit's "this needs you" banner.
 * Sent before → it opens that report. Otherwise `to` opens the one screen with it, or `onPress` attaches it there.
 */
export function WaitingRecording({ rec, to, onPress }: { rec: PendingRecording; to?: string; onPress?: () => void }) {
  const C = useCopy(COACHING);
  const { days } = useCopy(LESSONS);
  const minutes = rec.seconds != null ? Math.max(1, Math.round(rec.seconds / 60)) : null;
  const day = pkDayOf(rec.receivedAt);
  const line = [C.fromWhatsApp, minutes != null ? C.minutes(minutes) : null, day ? dayName(day, pkToday(), days) : null]
    .filter(Boolean).join(' · ');
  const repeat = rec.duplicateOf;
  return (
    <AttentionBanner
      testId="dc-waiting"
      text={(
        <span className="flex flex-col">
          <span>{line}</span>
          <span className="font-normal">{repeat ? C.sentBefore : C.addDetailsSend}</span>
        </span>
      )}
      to={repeat ? lessonPath(repeat.sessionId) : to}
      onPress={repeat ? undefined : onPress}
    />
  );
}

/**
 * The one screen's step heading (design v6, FlowStep): its number in a 36px dot — indigo while it is the step she is on,
 * green with a tick once done, flat grey before she gets there (never tappable-looking) — then its name and chips.
 */
export function FlowStep({ n, state, children, chips }: {
  n: number; state: 'upcoming' | 'now' | 'done'; children: ReactNode; chips?: readonly string[];
}) {
  return (
    <h2
      data-step-state={state}
      className={cn(
        'mx-1 mt-2 flex min-h-[56px] items-center gap-3 text-[20px] leading-tight',
        state === 'now' ? 'font-semibold text-[#1d2025]' : state === 'done' ? 'font-light text-[#1d2025]' : 'font-light text-[#6b7280]',
      )}
    >
      <span
        aria-hidden="true"
        className={cn(
          'flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-[16px] font-extrabold tabular-nums',
          state === 'now' && 'bg-[#33374a] text-white',
          state === 'done' && 'bg-[#2f7a52] text-white',
          state === 'upcoming' && 'bg-[#e5e7eb] text-[#6b7280]',
        )}
      >
        {state === 'done' ? <Check className="h-[18px] w-[18px]" strokeWidth={3.2} /> : n}
      </span>
      <span className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
        {children}
        {state !== 'upcoming' ? (chips ?? []).map((c) => (
          <span key={c} className="inline-flex h-[26px] items-center rounded-full bg-[#e5e7eb] px-2.5 text-[12px] font-semibold text-[#374151]">{c}</span>
        )) : null}
      </span>
    </h2>
  );
}
