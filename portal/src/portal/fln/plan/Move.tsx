/**
 * bd-t7zk3t.11 — one numbered move (DESIGN v2 §2 S4.5): the step text (markdown subset, escaped), the Say:/Ask:/Answer:
 * label in the PLAN's own words (the corpus's item types; `instruction` gets none), then the step's media in order:
 * a SoundPill for EVERY audio occurrence (repeats keep their own pill; the label chain lives in the player's clips.ts),
 * images in reserved boxes, videos as poster + Watch, pdfs as a ≥48 px link.
 */
import { itemClips, SoundPill } from '../player';
import { flnStrings, num, type FlnLang } from '../strings';
import type { FlnItem, FlnMedia } from '../types';
import { MediaImage } from './MediaImage';
import { MediaVideo } from './MediaVideo';
import { isolate, oneLine, PlanText } from './text';

export interface MoveProps {
  item: FlnItem;
  /** The move's number within its section; omitted for setup/summary items. */
  n?: number;
  planLang: FlnLang;
  planDir: 'ltr' | 'rtl';
  uiLang: FlnLang;
}

export function Move({ item, n, planLang, planDir, uiLang }: MoveProps) {
  const rtl = planDir === 'rtl';
  const ps = flnStrings(planLang);
  const s = flnStrings(uiLang);
  const clips = itemClips(item, planLang);
  const media = item.media || [];
  const visual = media.filter((m) => m.kind !== 'audio');
  const kindLabel = item.kind !== 'instruction' && ps.itemKind[item.kind] ? ps.itemKind[item.kind] : null;
  const alt = oneLine(item.text);
  return (
    <div className={`fln-move fln-move--${item.kind}`} lang={planLang} dir={planDir}>
      {n != null ? <span className="fln-no" aria-hidden="true">{isolate(num(n, planLang), true)}</span> : <span className="fln-no fln-no--none" aria-hidden="true" />}
      <div className="fln-move-body">
        <p className={`fln-do${item.kind === 'answer' ? ' fln-do--ans' : ''}`}>
          {kindLabel ? <><b className="fln-kind">{kindLabel}</b>{' '}</> : null}
          <PlanText text={item.text} rtl={rtl} />
        </p>
        {clips.length ? (
          <div className="fln-pills">
            {clips.map((c, i) => (
              <SoundPill key={`${c.id}:${i}`} clipId={c.id} label={c.label} caption={c.caption} lang={planLang} dir={planDir} role={c.role} />
            ))}
          </div>
        ) : null}
        {visual.map((m: FlnMedia, i) => {
          if (m.kind === 'image') return <MediaImage key={`i${i}`} media={m} alt={alt} uiLang={uiLang} />;
          if (m.kind === 'video') return <MediaVideo key={`v${i}`} media={m} uiLang={uiLang} />;
          if (m.kind === 'pdf') {
            return (
              <a key={`p${i}`} className="fln-pdf" href={m.src} target="_blank" rel="noopener noreferrer" lang={uiLang} dir={uiLang === 'ur' ? 'rtl' : 'ltr'}>
                {isolate(s.pdf, uiLang === 'ur')}
              </a>
            );
          }
          return null;
        })}
      </div>
    </div>
  );
}
