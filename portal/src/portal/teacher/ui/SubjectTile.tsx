import type { ReactElement } from 'react';
import { cn } from '@/lib/utils';
import { SUBJECT_GLYPH, subjectIcon, type SubjectIconKey } from './subjects';

/**
 * bd-fmf24g.2.1 — SubjectTile (COMPONENTS.md "SubjectTile"): a rounded-12 square with the subject's icon. Neutral
 * grey #f3f4f6 with an indigo icon; `selected` tints it #e8e9f0; `dim` greys the icon. The icon is 46% of the
 * size; English and Urdu are letters ("Aa", "اب"), 800 weight at 33%. Decorative: the row it sits in names the
 * subject in words. Drawings are the canvas's own (SubjectTile.dc.html).
 */

export type SubjectTileTone = 'neutral' | 'selected' | 'dim';

export interface SubjectTileProps {
  subject: string;
  /** px; 48 everywhere in the app. */
  size?: number;
  tone?: SubjectTileTone;
  className?: string;
}

const ICON: Record<Exclude<SubjectIconKey, 'en' | 'ur'>, ReactElement> = {
  calc: (
    <>
      <rect x="4" y="2" width="16" height="20" rx="2" />
      <path d="M8 6h8M8 10h.01M12 10h.01M16 10h.01M8 14h.01M12 14h.01M16 14h.01M8 18h.01M12 18h.01M16 18h.01" />
    </>
  ),
  flask: (
    <>
      <path d="M9 2h6M10 2v6L4.5 18.5A2 2 0 0 0 6.3 21h11.4a2 2 0 0 0 1.8-2.5L14 8V2" />
      <path d="M7 15h10" />
    </>
  ),
  monitor: (
    <>
      <rect x="2" y="3" width="20" height="14" rx="2" />
      <path d="M8 21h8M12 17v4" />
    </>
  ),
  atom: (
    <g strokeWidth="1.8">
      <circle cx="12" cy="12" r="1.6" />
      <ellipse cx="12" cy="12" rx="10" ry="4" />
      <ellipse cx="12" cy="12" rx="10" ry="4" transform="rotate(60 12 12)" />
      <ellipse cx="12" cy="12" rx="10" ry="4" transform="rotate(120 12 12)" />
    </g>
  ),
  tube: (
    <>
      <path d="M8.5 2h7M10 2v16a2 2 0 0 0 4 0V2" />
      <path d="M10 12h4" />
    </>
  ),
  sprout: (
    <>
      <path d="M7 21h10M12 21v-9" />
      <path d="M12 12C12 8 9 6 5 6c0 4 3 6 7 6zM12 10c0-3 2-5 6-5 0 3-2 5-6 5z" />
    </>
  ),
  landmark: <path d="M3 21h18M5 21v-9M9.5 21v-9M14.5 21v-9M19 21v-9M2 10l10-7 10 7z" />,
  globe: (
    <>
      <circle cx="12" cy="12" r="10" />
      <path d="M2 12h20M12 2a15 15 0 0 1 0 20M12 2a15 15 0 0 0 0 20" />
    </>
  ),
  bookmark: (
    <>
      <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20V2H6.5A2.5 2.5 0 0 0 4 4.5z" />
      <path d="M4 19.5A2.5 2.5 0 0 0 6.5 22H20v-5" />
      <path d="M10 2v8l3-2 3 2V2" />
    </>
  ),
  wheat: (
    <>
      <path d="M12 22V7" />
      <path d="M12 7c-2.2-.6-3.5-2.4-3.5-5 2.2.6 3.5 2.4 3.5 5zm0 0c2.2-.6 3.5-2.4 3.5-5-2.2.6-3.5 2.4-3.5 5zM12 12.5c-2.2-.6-3.5-2.4-3.5-5 2.2.6 3.5 2.4 3.5 5zm0 0c2.2-.6 3.5-2.4 3.5-5-2.2.6-3.5 2.4-3.5 5zM12 18c-2.2-.6-3.5-2.4-3.5-5 2.2.6 3.5 2.4 3.5 5zm0 0c2.2-.6 3.5-2.4 3.5-5-2.2.6-3.5 2.4-3.5 5z" />
    </>
  ),
  bulb: <path d="M9 18h6M10 22h4M12 2a7 7 0 0 0-4 12.7V16h8v-1.3A7 7 0 0 0 12 2z" />,
  scroll: (
    <>
      <path d="M19 17V5a2 2 0 0 0-2-2H4" />
      <path d="M8 21h12a2 2 0 0 0 2-2v-2H10v2a2 2 0 1 1-4 0V5a2 2 0 1 0-4 0v3h4" />
      <path d="M10 8h5M10 12h5" />
    </>
  ),
  book: (
    <>
      <path d="M2 4h6a4 4 0 0 1 4 4v13a3 3 0 0 0-3-3H2z" />
      <path d="M22 4h-6a4 4 0 0 0-4 4v13a3 3 0 0 1 3-3h7z" />
    </>
  ),
};

export function SubjectTile({ subject, size = 48, tone = 'neutral', className }: SubjectTileProps) {
  const key = subjectIcon(subject);
  const glyph = SUBJECT_GLYPH[key];
  const iconPx = Math.round(size * 0.46);
  return (
    <span
      aria-hidden="true"
      data-icon={key}
      style={{ width: size, height: size, fontSize: Math.round(size * 0.33) }}
      className={cn(
        'flex shrink-0 items-center justify-center rounded-xl font-extrabold leading-none',
        tone === 'selected' ? 'bg-[#e8e9f0]' : 'bg-[#f3f4f6]',
        tone === 'dim' ? 'text-[#9ca3af]' : 'text-[#33374a]',
        className,
      )}
    >
      {glyph ?? (
        <svg
          width={iconPx}
          height={iconPx}
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          {ICON[key as keyof typeof ICON]}
        </svg>
      )}
    </span>
  );
}
