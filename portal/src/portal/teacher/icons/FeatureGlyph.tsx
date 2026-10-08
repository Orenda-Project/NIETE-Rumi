import type { CSSProperties, ReactElement } from 'react';
import type { TeacherFeature } from './features';

/**
 * bd-fmf24g.2.1 — the menu's 24px glyphs from the v28 canvas (Main.dc.html's `g-*` sprite + the inline Home and
 * More glyphs of its bottom menu). One colour: `currentColor`, so the menu decides (grey, or the active green).
 * Details knocked out of a filled shape (the phone's sound bars, the paper's "A+") take the surface colour from
 * the CSS variable `--cut` — white unless the parent sets it (a tile on a tint sets `--cut` to that tint).
 */

export type GlyphName = TeacherFeature | 'home' | 'more';

const CUT: CSSProperties = { stroke: 'var(--cut, #fff)' };

const GLYPH: Record<GlyphName, ReactElement> = {
  home: (
    <path d="M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
  ),
  lessons: (
    <g fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 6.5C9.8 4.9 6.6 4.4 2 5v13c4.6-.6 7.8 0 10 1.5z" />
      <path d="M12 6.5c2.2-1.6 5.4-2.1 10-1.5v13c-4.6-.6-7.8 0-10 1.5z" />
      <path d="M15 5.6v7.4l1.8-1.4 1.8 1.4V5.1z" fill="currentColor" />
    </g>
  ),
  coaching: (
    <g fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="5" y="2" width="11.5" height="20" rx="2.6" />
      <rect x="7.3" y="4.7" width="6.9" height="12.3" rx="1" fill="currentColor" stroke="none" />
      <path d="M9 10.1v2.4M10.75 8.4v5.8M12.5 9.6v3.4" strokeWidth="1.3" style={CUT} />
      <circle cx="10.75" cy="19.4" r=".9" fill="currentColor" stroke="none" />
      <path d="M20.7 1.8l.64 1.66 1.66.64-1.66.64-.64 1.66-.64-1.66-1.66-.64 1.66-.64z" fill="currentColor" stroke="none" />
      <path d="M21.2 9l.34.86.86.34-.86.34-.34.86-.34-.86-.86-.34.86-.34z" fill="currentColor" stroke="none" />
    </g>
  ),
  observations: (
    <g fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="7" cy="12" r="2.5" fill="currentColor" />
      <path d="M2 21.5a5 5 0 0 1 10 0z" fill="currentColor" />
      <circle cx="16.8" cy="14.6" r="2.1" />
      <path d="M13 21.5a3.9 3.9 0 0 1 7.8 0" />
      <path d="M13.5 2h7a2 2 0 0 1 2 2v2.6a2 2 0 0 1-2 2h-3l-2.4 2v-2h-1.6a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2z" />
      <path d="M15 5.3l1.2 1.2 2.3-2.3" />
    </g>
  ),
  training: (
    <g fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M22.5 8.5 12 3.3 1.5 8.5 12 13.7z" fill="currentColor" />
      <path d="M6 11v4.4c1.6 1.3 3.8 2 6 2s4.4-.7 6-2V11" />
      <path d="M20.4 9.6v5" />
      <circle cx="20.4" cy="16.2" r="1.3" fill="currentColor" />
    </g>
  ),
  assessment: (
    <g fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12.5 21.5H5a2 2 0 0 1-2-2v-15a2 2 0 0 1 2-2h8.5L17 6v4" />
      <path d="M6 9h6M6 12.5h4" />
      <circle cx="17.2" cy="16.8" r="5.2" fill="currentColor" />
      <path d="M14.8 19l1.5-4.3 1.5 4.3M15.3 17.8h2M19.7 15.6v2.6M18.4 16.9H21" strokeWidth="1.3" style={CUT} />
    </g>
  ),
  attendance: (
    <g fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="4.5" width="18" height="17" rx="2.5" />
      <path d="M5.5 4.5h13A2.5 2.5 0 0 1 21 7v3H3V7a2.5 2.5 0 0 1 2.5-2.5z" fill="currentColor" />
      <path d="M8 2v4M16 2v4" />
      <path d="M7.8 15.4l2.8 2.8 5.6-5.6" strokeWidth="2.6" />
    </g>
  ),
  classes: (
    <g fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="2.5" y="2.5" width="19" height="11" rx="1.8" fill="currentColor" />
      <path d="M5.5 6h7M5.5 9.4h4.5" strokeWidth="1.6" style={CUT} />
      <circle cx="6" cy="17.2" r="1.7" />
      <circle cx="12" cy="17.2" r="1.7" />
      <circle cx="18" cy="17.2" r="1.7" />
      <path d="M3.3 22.3a2.7 2.7 0 0 1 5.4 0M9.3 22.3a2.7 2.7 0 0 1 5.4 0M15.3 22.3a2.7 2.7 0 0 1 5.4 0" />
    </g>
  ),
  more: (
    <g fill="currentColor">
      <circle cx="5" cy="12" r="2" />
      <circle cx="12" cy="12" r="2" />
      <circle cx="19" cy="12" r="2" />
    </g>
  ),
};

export interface FeatureGlyphProps {
  name: GlyphName;
  /** px; the menu draws them at 24. */
  size?: number;
  /** Only when the glyph stands alone: makes it an image with this name. */
  label?: string;
  className?: string;
}

export function FeatureGlyph({ name, size = 24, label, className }: FeatureGlyphProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      data-glyph={name}
      className={className}
      {...(label ? { role: 'img', 'aria-label': label } : { 'aria-hidden': true })}
    >
      {GLYPH[name]}
    </svg>
  );
}
