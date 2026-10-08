import type { ReactElement } from 'react';
import type { TeacherFeature } from './features';

/**
 * bd-fmf24g.2.1 — the teacher app's feature illustrations: the D2-refined 48px spot art from the v28 canvas
 * (Main.dc.html's `r-*` sprite, identical to the D2-refined row of IconOptions2.dc.html). Drawn in the app's ink
 * outline (#33374a, 1.25) with each feature's own hue. Digital Coaching is a PHONE.
 *
 * Home draws them on the tiles (76–80px, no background disc: `.hart`). They are decorative unless a `label` is
 * given — the tile's words already name the feature.
 */

const ART: Record<TeacherFeature, ReactElement> = {
  lessons: (
    <g stroke="#33374a" strokeWidth="1.25" strokeLinecap="round" strokeLinejoin="round">
      <path d="M5 13.5c6.5-2.2 13-1.6 19 1.8 6-3.4 12.5-4 19-1.8v24.5c-6.5-2.2-13-1.6-19 1.8-6-3.4-12.5-4-19-1.8z" fill="#2f7a52" />
      <path d="M8 12.5c5.5-1.4 10.8-.8 16 2.4v23.6c-5.2-3.2-10.5-3.8-16-2.4z" fill="#fff" />
      <path d="M40 12.5c-5.5-1.4-10.8-.8-16 2.4v23.6c5.2-3.2 10.5-3.8 16-2.4z" fill="#eaf6ef" />
      <path d="M11.5 19.5c3.2-.6 6-.3 8.8.9M11.5 24c3.2-.6 6-.3 8.8.9M11.5 28.5c3.2-.6 6-.3 8.8.9M36.5 30c-2.6-.5-5-.3-7.2.6" fill="none" stroke="#2f7a52" />
      <path d="M29.5 13.8v12.6l2.6-2 2.6 2V13z" fill="#2f7a52" />
    </g>
  ),
  coaching: (
    <g stroke="#33374a" strokeWidth="1.25" strokeLinecap="round" strokeLinejoin="round">
      <rect x="13" y="4" width="22" height="40" rx="5" fill="#ffedd5" />
      <rect x="16" y="9" width="16" height="27" rx="2.5" fill="#c2410c" />
      <path d="M21.5 6.5h5" fill="none" />
      <circle cx="24" cy="40" r="1.6" fill="#fff" />
      <path d="M19.5 20.5v6M22.5 17v13M25.5 19.5v8M28.5 21.5v4" fill="none" stroke="#fff" strokeWidth="2.2" />
      <path d="M40.5 4.5 41.76 7.74 45 9 41.76 10.26 40.5 13.5 39.24 10.26 36 9 39.24 7.74z" fill="#d4a017" />
      <path d="M42 17.1 42.67 18.83 44.4 19.5 42.67 20.17 42 21.9 41.33 20.17 39.6 19.5 41.33 18.83z" fill="#d4a017" />
      <path d="M8 27.4 8.73 29.27 10.6 30 8.73 30.73 8 32.6 7.27 30.73 5.4 30 7.27 29.27z" fill="#c2410c" />
    </g>
  ),
  observations: (
    <g stroke="#33374a" strokeWidth="1.25" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4.5 44a10.5 10.5 0 0 1 21 0z" fill="#c8331f" />
      <circle cx="15" cy="26.5" r="5.5" fill="#fee4e2" />
      <path d="M24.5 44a9.5 9.5 0 0 1 19 0z" fill="#fee4e2" />
      <circle cx="34" cy="29.5" r="5" fill="#fff" />
      <path d="M25.5 4h14a3 3 0 0 1 3 3v7a3 3 0 0 1-3 3H33l-4.5 4v-4h-3a3 3 0 0 1-3-3V7a3 3 0 0 1 3-3z" fill="#fff" />
      <path d="M28.5 10.5l3 3 6-6" fill="none" stroke="#c8331f" strokeWidth="2.2" />
    </g>
  ),
  training: (
    <g stroke="#33374a" strokeWidth="1.25" strokeLinecap="round" strokeLinejoin="round">
      <path d="M13 23v9c3 2.6 6.8 4 11 4s8-1.4 11-4v-9" fill="#eeeafd" />
      <path d="M45 18.5 24 8 3 18.5 24 29z" fill="#6e52e0" />
      <circle cx="24" cy="18.5" r="1.7" fill="#33374a" />
      <path d="M24 18.5l15.5 3.2v10.3" fill="none" stroke="#d4a017" strokeWidth="1.8" />
      <circle cx="39.5" cy="34" r="2.6" fill="#d4a017" />
      <path d="M38 36.5v5M39.5 36.5v5.5M41 36.5v5" fill="none" stroke="#d4a017" strokeWidth="1.4" />
    </g>
  ),
  assessment: (
    <g stroke="#33374a" strokeWidth="1.25" strokeLinecap="round" strokeLinejoin="round">
      <path d="M11 5h16l8 8v28.5a2.5 2.5 0 0 1-2.5 2.5H11a2.5 2.5 0 0 1-2.5-2.5v-34A2.5 2.5 0 0 1 11 5z" fill="#fff" />
      <path d="M27 5v8h8" fill="#e3eefc" />
      <path d="M12.5 19l2 2 3.5-3.5M12.5 26l2 2 3.5-3.5" fill="none" stroke="#1d6fd8" strokeWidth="1.8" />
      <path d="M21.5 19.5h7.5M21.5 26.5h5.5M12.5 33h7" fill="none" stroke="#1d6fd8" />
      <circle cx="35" cy="35" r="9" fill="#1d6fd8" />
      <path d="M30.4 39l3-8 3 8M31.5 36.4h3.8M39.3 32.6v4.6M37 34.9h4.6" fill="none" stroke="#fff" strokeWidth="1.8" />
    </g>
  ),
  attendance: (
    <g stroke="#33374a" strokeWidth="1.25" strokeLinecap="round" strokeLinejoin="round">
      <rect x="6" y="9" width="36" height="33" rx="4" fill="#fff" />
      <path d="M10 9h28a4 4 0 0 1 4 4v5H6v-5a4 4 0 0 1 4-4z" fill="#33374a" />
      <rect x="14.5" y="5" width="3.5" height="8" rx="1.75" fill="#e8e9f0" />
      <rect x="30" y="5" width="3.5" height="8" rx="1.75" fill="#e8e9f0" />
      <circle cx="37" cy="24" r="1.6" fill="#e8e9f0" />
      <circle cx="37" cy="30" r="1.6" fill="#e8e9f0" />
      <circle cx="37" cy="36" r="1.6" fill="#e8e9f0" />
      <path d="M13.5 30l5.5 5.5L30.5 24" fill="none" strokeWidth="3.4" />
    </g>
  ),
  classes: (
    <g stroke="#33374a" strokeWidth="1.25" strokeLinecap="round" strokeLinejoin="round">
      <rect x="5" y="4" width="38" height="22" rx="3" fill="#0f766e" />
      <path d="M10 10h14M10 15h10M10 20h7" fill="none" stroke="#fff" />
      <path d="M31 15.5l2.5 2.5 5-5" fill="none" stroke="#fff" strokeWidth="1.8" />
      <path d="M7.5 43a5.5 5.5 0 0 1 11 0z" fill="#ccfbf1" />
      <path d="M18.5 43a5.5 5.5 0 0 1 11 0z" fill="#ccfbf1" />
      <path d="M29.5 43a5.5 5.5 0 0 1 11 0z" fill="#ccfbf1" />
      <circle cx="13" cy="32.5" r="3.2" fill="#fff" />
      <circle cx="24" cy="32.5" r="3.2" fill="#fff" />
      <circle cx="35" cy="32.5" r="3.2" fill="#fff" />
    </g>
  ),
};

/**
 * Never animated (operator, 2026-10-08: "the icons on the menu are now animated"): no
 * animation or transition can apply to the icon or anything inside it, whatever a page or a
 * global stylesheet says. Inline + !important, so it wins over any class rule.
 */
const STILL = "[animation:none!important] [&_*]:[animation:none!important] [transition:none!important] [&_*]:[transition:none!important]";

export interface FeatureArtProps {
  feature: TeacherFeature;
  /** px; 48 is the drawing's own size, Home uses 76–80. */
  size?: number;
  /** Only when the art stands alone: makes it an image with this name. */
  label?: string;
  className?: string;
}

export function FeatureArt({ feature, size = 48, label, className }: FeatureArtProps) {
  return (
    <svg
      viewBox="0 0 48 48"
      width={size}
      height={size}
      data-feature-art={feature}
      data-still="true"
      className={className ? `${STILL} ${className}` : STILL}
      {...(label ? { role: 'img', 'aria-label': label } : { 'aria-hidden': true })}
    >
      {ART[feature]}
    </svg>
  );
}
