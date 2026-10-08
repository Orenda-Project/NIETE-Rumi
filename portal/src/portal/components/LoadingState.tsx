import { cn } from '@/lib/utils';
import { PageSkeleton, SkeletonLine } from './Skeleton';

interface LoadingStateProps {
  type?: 'card' | 'list' | 'table' | 'full';
  count?: number;
  className?: string;
}

/**
 * bd-fxk3t8 — placeholder blocks in the shape of what is loading (the Skeleton kit; they
 * shimmer only when motion is allowed). `full` used to be a full-screen spinner; it is a
 * page outline inside the page now, so the menu and anything already drawn stay put.
 */
const LoadingState = ({ type = 'card', count = 3, className }: LoadingStateProps) => {
  if (type === 'full') {
    return <PageSkeleton kind="list" className={className} />;
  }

  if (type === 'card') {
    return (
      <div aria-busy="true" className={cn("grid gap-6 grid-cols-1 md:grid-cols-2 lg:grid-cols-3", className)}>
        {Array.from({ length: count }).map((_, i) => (
          <div key={i} className="bg-white rounded-lg p-6 shadow-sm border border-border">
            <div className="space-y-4">
              <SkeletonLine className="h-4 w-3/4 rounded" />
              <SkeletonLine className="w-1/2 rounded" />
              <div className="space-y-2">
                <SkeletonLine className="h-2 w-full rounded" />
                <SkeletonLine className="h-2 w-5/6 rounded" />
              </div>
              <div className="flex gap-2 pt-2">
                <SkeletonLine className="h-8 flex-1 rounded" />
                <SkeletonLine className="h-8 flex-1 rounded" />
              </div>
            </div>
          </div>
        ))}
      </div>
    );
  }

  if (type === 'list') {
    return (
      <div aria-busy="true" className={cn("space-y-4", className)}>
        {Array.from({ length: count }).map((_, i) => (
          <div key={i} className="bg-white rounded-lg p-6 shadow-sm border border-border">
            <div className="flex items-center gap-4">
              <SkeletonLine className="h-12 w-12 shrink-0 rounded-full" />
              <div className="flex-1 space-y-2">
                <SkeletonLine className="h-4 w-1/3 rounded" />
                <SkeletonLine className="w-1/2 rounded" />
              </div>
            </div>
          </div>
        ))}
      </div>
    );
  }

  // table type
  return (
    <div aria-busy="true" className={cn("bg-white rounded-lg shadow-sm border border-border overflow-hidden", className)}>
      <div className="p-6 space-y-4">
        {Array.from({ length: count }).map((_, i) => (
          <div key={i} className="flex items-center gap-4">
            <SkeletonLine className="h-4 flex-1 rounded" />
            <SkeletonLine className="h-4 flex-1 rounded" />
            <SkeletonLine className="h-4 flex-1 rounded" />
          </div>
        ))}
      </div>
    </div>
  );
};

export default LoadingState;
