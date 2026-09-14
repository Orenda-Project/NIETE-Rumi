import { LucideIcon } from 'lucide-react';
import { cn } from '@/lib/utils';

interface StatCardProps {
  title: string;
  value: string | number;
  icon: LucideIcon;
  trend?: {
    value: number;
    isPositive: boolean;
  };
  /** A second line under the number — a scale, a level name, a denominator. */
  detail?: string | null;
  /**
   * Tighter padding and a smaller number, for a row of several stats where no
   * single one is the headline. Added rather than shrinking the default
   * because the leader pages use this card at full size.
   */
  compact?: boolean;
  className?: string;
}

const StatCard = ({ title, value, icon: Icon, trend, detail, compact, className }: StatCardProps) => {
  return (
    <div className={cn(
      "bg-white rounded-lg shadow-sm border border-border hover:shadow-md transition-shadow",
      compact ? "p-4" : "p-6",
      className
    )}>
      <div className="flex items-start justify-between">
        <div className="flex-1 min-w-0">
          <p className={cn("text-muted-foreground mb-1", compact ? "text-xs" : "text-sm")}>{title}</p>
          <p className={cn(
            "font-bold text-foreground tabular-nums",
            compact ? "text-2xl" : "text-3xl",
          )}>{value}</p>
          {detail && (
            <p className="text-xs text-muted-foreground mt-0.5 truncate">{detail}</p>
          )}
          {trend && (
            <p className={cn(
              "text-sm mt-2",
              trend.isPositive ? "text-success" : "text-error"
            )}>
              {trend.isPositive ? "↑" : "↓"} {Math.abs(trend.value)}%
            </p>
          )}
        </div>
        <div className={cn("bg-accent/10 rounded-lg shrink-0", compact ? "p-2" : "p-3")}>
          <Icon className={cn("text-accent", compact ? "w-4 h-4" : "w-6 h-6")} aria-hidden="true" />
        </div>
      </div>
    </div>
  );
};

export default StatCard;
