import { Link } from 'react-router-dom';
import { ArrowRight } from 'lucide-react';

/**
 * The end of every page on the principal's STEPS journey:
 *   1 My Patch → 2 a teacher → 3 her lessons (S·T·E) → 4 attendance (P)
 *   → 5 remarks (S)
 * so the navigation guides her instead of leaving her to find the next page
 * (principal-dashboard feedback, item 5).
 */
const NextStep = ({ to, step, label }: { to: string; step: number; label: string }) => (
  <div className="mt-8 flex justify-end">
    <Link
      to={to}
      data-testid="next-step"
      className="inline-flex items-center gap-2 rounded-lg border border-accent/30 bg-accent/5 px-4 py-3 text-sm font-medium text-accent hover:bg-accent/10 transition-colors"
    >
      <span className="text-xs uppercase tracking-wide text-muted-foreground">Next · step {step}</span>
      <span>{label}</span>
      <ArrowRight className="w-4 h-4" aria-hidden="true" />
    </Link>
  </div>
);

export default NextStep;
