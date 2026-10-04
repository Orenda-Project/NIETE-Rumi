import { ArrowRight } from 'lucide-react';
import ChalkboardIcon from './ChalkboardIcon';

/**
 * bd-5rz1v.7 — Option B3: the one button that names the goal ("Send a lesson to
 * your Digital Coach"), in deep green with a chalkboard. It opens the Send a
 * lesson sheet; the way to do it (record now, or upload) is chosen there.
 *
 * bd-5rz1v.9 — it read as a banner, so it is now shaped like a button (the
 * "Chosen" row in NIETE Portal Coaching/versions/v1_tap-and-record-mockups):
 * chalkboard at the start, the words, a white arrow at the end; a raised edge
 * that sinks when pressed. Two quiet signals point at the tap: a soft light
 * sweeps across it every 4s, and a ring pulses out of the arrow every 2s. Both
 * stop for reduced motion. The ripple behind the chalkboard is gone (it read as
 * "live", not "tap"). In RTL the row mirrors and the arrow turns round.
 *
 * Shared by the teacher's Coaching page and the coach's Observations page.
 */
const SendLessonButton = ({ title, sub, onClick, testId }: {
  title: string;
  sub: string;
  onClick: () => void;
  testId?: string;
}) => (
  <button
    type="button"
    onClick={onClick}
    data-testid={testId}
    className="relative mb-[5px] flex w-full items-center gap-3.5 overflow-hidden rounded-[18px] bg-[#2e7d57] py-4 pe-3.5 ps-4 text-start text-white shadow-[0_5px_0_#1d5a3d,0_10px_20px_rgba(46,125,87,0.28)] transition-[transform,box-shadow,background-color] duration-[80ms] ease-out hover:bg-[#2a7350] active:translate-y-1 active:shadow-[0_1px_0_#1d5a3d,0_3px_8px_rgba(46,125,87,0.25)] focus-visible:outline focus-visible:outline-[3px] focus-visible:outline-offset-[3px] focus-visible:outline-[#ffd54f] motion-reduce:transition-none sm:gap-5 sm:px-6 sm:py-5"
  >
    <span className="flex h-[58px] w-[58px] shrink-0 items-center justify-center rounded-full bg-white" aria-hidden="true">
      <ChalkboardIcon size={36} />
    </span>
    <span className="flex min-w-0 flex-1 flex-col gap-[3px]">
      <span className="text-[18.5px] font-bold leading-[1.22] sm:text-[22px]" dir="auto">{title}</span>
      <span className="text-[13px] leading-snug text-[#d9f0e3] sm:text-[15px]" dir="auto">{sub}</span>
    </span>
    <span
      data-testid="send-lesson-arrow"
      aria-hidden="true"
      className="flex h-[42px] w-[42px] shrink-0 items-center justify-center rounded-full bg-white text-[#2e7d57] animate-send-halo motion-reduce:animate-none"
    >
      <ArrowRight size={22} strokeWidth={2.6} className="rtl:rotate-180" />
    </span>
    {/* The light sweep. The outer layer mirrors in RTL so it travels with the reading direction. */}
    <span className="pointer-events-none absolute inset-0 rtl:-scale-x-100" aria-hidden="true">
      <span
        data-testid="send-lesson-sheen"
        className="pointer-events-none absolute inset-y-0 left-0 w-[45%] bg-[linear-gradient(100deg,transparent,rgba(255,255,255,0.3),transparent)] animate-send-sheen motion-reduce:hidden"
      />
    </span>
  </button>
);

export default SendLessonButton;
