/**
 * bd-5rz1v.7 — a classroom chalkboard on its easel: the picture on the "Send a
 * lesson" button, so it reads as "my lesson" before a word is read.
 */
const ChalkboardIcon = ({ size = 54 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 64 64" aria-hidden="true">
    <rect x="5" y="8" width="54" height="36" rx="3" fill="#2f5d46" stroke="#9a6a35" strokeWidth="4" />
    <path d="M13 19h18M13 27h28M13 35h12" stroke="#e8f5ee" strokeWidth="3" strokeLinecap="round" />
    <circle cx="47" cy="33" r="5" fill="#ffd54f" />
    <path d="M20 44l-6 14M44 44l6 14" stroke="#9a6a35" strokeWidth="4" strokeLinecap="round" />
  </svg>
);

export default ChalkboardIcon;
