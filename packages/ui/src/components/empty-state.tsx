import type { LucideIcon } from "lucide-react";
import { cn } from "../lib/cn";

export interface EmptyStateProps {
  icon?: LucideIcon;
  title: string;
  description?: string;
  action?: React.ReactNode;
  secondaryAction?: React.ReactNode;
  className?: string;
}

// ui-design-system.md §6: "illustration (sm) + one-line headline + one-
// line help + primary CTA (+ 'import' secondary where relevant)." Real
// illustration artwork (§3.8) isn't produced yet — this takes a Lucide
// icon in that slot as a v1 stand-in, swappable later without touching
// callers.
export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
  secondaryAction,
  className,
}: EmptyStateProps) {
  return (
    <div className={cn("flex flex-col items-center gap-3 px-6 py-12 text-center", className)}>
      {Icon && (
        <div className="flex size-10 items-center justify-center rounded-full bg-brand-50">
          <Icon className="size-5 text-brand" />
        </div>
      )}
      <div className="flex flex-col gap-1">
        <p className="text-md font-medium text-neutral-900">{title}</p>
        {description && <p className="text-sm text-neutral-500">{description}</p>}
      </div>
      {(action || secondaryAction) && (
        <div className="flex items-center gap-2 pt-2">
          {action}
          {secondaryAction}
        </div>
      )}
    </div>
  );
}
