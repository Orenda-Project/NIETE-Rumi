import ChalkboardIcon from './ChalkboardIcon';

/**
 * bd-5rz1v.7 — Option B3: the one button that names the goal ("Send a lesson to
 * your Digital Coach"), in deep green with a chalkboard. It opens the Send a
 * lesson sheet; the way to do it (record now, or upload) is chosen there.
 * A ripple behind the chalkboard keeps it alive, still for reduced motion.
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
    className="flex w-full flex-col items-center gap-3 rounded-[20px] border-[3px] border-[#2e7d57] bg-[#2e7d57] px-5 py-6 text-center text-white shadow-[0_6px_18px_rgba(46,125,87,0.25)] sm:flex-row sm:gap-6 sm:px-8 sm:text-left"
  >
    <span className="relative flex h-[88px] w-[88px] shrink-0 items-center justify-center" aria-hidden="true">
      <span className="absolute inset-0 rounded-full bg-[rgba(255,255,255,0.35)] animate-rec-wave motion-reduce:hidden" />
      <span className="relative flex h-[88px] w-[88px] items-center justify-center rounded-full bg-white">
        <ChalkboardIcon size={54} />
      </span>
    </span>
    <span className="flex flex-col gap-1.5">
      <span className="text-2xl font-bold leading-tight sm:text-[28px]">{title}</span>
      <span className="text-[15px] leading-snug text-[#d9f0e3] sm:text-base">{sub}</span>
    </span>
  </button>
);

export default SendLessonButton;
