import { Link } from 'react-router-dom';
import AttentionDot from './AttentionDot';

/**
 * bd-5rz1v — the navy bar right under the navigation: "3 lessons need your
 * answer → Answer". It spans the page edge to edge (the layout pads its
 * content, so the bar steps back out of that padding) and opens the OLDEST
 * lesson waiting for her, so she clears them in the order she taught them.
 */
const NeedsAnswerBanner = ({ text, action, to }: { text: string; action: string; to: string }) => (
  <div data-testid="needs-answer-banner" className="-mx-4 -mt-4 mb-4 bg-primary md:-mx-6 lg:-mx-8">
    {/* The whole bar is the tap target, not just the button-shaped label. */}
    <Link to={to} className="flex items-center gap-3 px-4 py-3 text-white no-underline md:px-6 lg:px-8">
      <AttentionDot />
      <span className="flex-1 text-[17px] font-bold">{text}</span>
      <span className="inline-flex h-11 items-center rounded-[10px] bg-white px-4 text-base font-bold text-primary">
        {action} <span aria-hidden="true" className="ml-1">›</span>
      </span>
    </Link>
  </div>
);

export default NeedsAnswerBanner;
