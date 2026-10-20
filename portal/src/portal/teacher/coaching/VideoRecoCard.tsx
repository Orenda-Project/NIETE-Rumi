import { Play } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { VideoRecommendation } from '../../types/portal';
import { useCopy } from '../i18n';
import { CARD, FOCUS } from '../ui/styles';
import { COACHING } from './copy';

/**
 * bd-gzfdu9 (VIDREC, SPEC §4.7) — the recommended training clip, right under "Try next class" on her report: the
 * /cr card's layout in the portal's look (design/mockups/cr_*.png). A 16:9 thumbnail with a play mark, the clip's
 * title, "⏱ {n} min · {language}", the one-line why from her own lesson, and ONE full-width Watch button that opens
 * the /v player in the same tab (the player links back). No level is shown (SPEC v1.2.1).
 *
 * The API sends `video_recommendation` only while VIDEO_RECO_ENABLED is on; absent, null, or with no link → nothing
 * is drawn, so the page is today's. The title and reason are DATA, in the report's language, as the API sends them.
 */
export function VideoRecoCard({ video }: { video?: VideoRecommendation | null }) {
  const C = useCopy(COACHING);
  if (!video || !video.href) return null;
  const minutes = Number.isFinite(video.durationS) && (video.durationS as number) > 0
    ? Math.max(1, Math.round((video.durationS as number) / 60))
    : null;
  const language = video.language ? C.videoRecoLanguage[video.language] : undefined;
  const meta = [minutes ? C.videoRecoMinutes(minutes) : null, minutes ? language : null].filter(Boolean).join(' · ');

  return (
    <section aria-label={C.videoRecoCardTitle} data-testid="video-reco-card" className={cn(CARD, 'flex flex-col gap-3 p-4')}>
      <h3 className="m-0 text-[17px] font-bold">{C.videoRecoCardTitle}</h3>
      <div className="relative aspect-video w-full overflow-hidden rounded-[12px] bg-[#33374a]">
        {video.thumbUrl ? <img src={video.thumbUrl} alt="" loading="lazy" className="h-full w-full object-cover" /> : null}
        <span aria-hidden="true" className="absolute inset-0 flex items-center justify-center">
          <span className="flex h-14 w-14 items-center justify-center rounded-full bg-white/90 text-[#1d2025]">
            <Play className="ms-0.5 h-6 w-6 fill-current" />
          </span>
        </span>
      </div>
      <div className="flex min-w-0 flex-col gap-1">
        {video.title ? <p dir="auto" className="m-0 break-words text-[17px] font-semibold leading-[1.35]">{video.title}</p> : null}
        {meta ? <p className="m-0 text-[14px] text-[#6b7280]">{meta}</p> : null}
      </div>
      {video.reason ? <p dir="auto" className="m-0 break-words text-[15px] leading-[1.5] text-[#374151]">{video.reason}</p> : null}
      <a
        href={video.href}
        className={cn('flex min-h-[48px] w-full items-center justify-center rounded-[14px] bg-[#47ba7d] px-4 text-[16px] font-semibold text-white no-underline', FOCUS)}
      >
        {minutes ? C.videoRecoCardButton(minutes) : C.videoRecoCardButtonPlain}
      </a>
    </section>
  );
}
