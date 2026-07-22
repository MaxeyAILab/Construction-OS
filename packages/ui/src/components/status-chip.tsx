import { cn } from "../lib/cn";
import type { StatusTone } from "../tokens";

export interface StatusChipProps {
  label: string;
  tone: StatusTone;
  className?: string;
}

const toneClasses: Record<StatusTone, string> = {
  neutral: "bg-neutral-100 text-neutral-700",
  success: "bg-success-50 text-success-700",
  warning: "bg-warning-50 text-warning-700",
  danger: "bg-danger-50 text-danger-700",
  ai: "bg-ai-50 text-ai-700",
};

// ui-design-system.md §7: "Single source of truth for every entity
// status: semantic color mapping table lives in tokens; never ad-hoc
// colored text." Callers map their domain status to a StatusTone once
// (e.g. in the schema/service layer); this component owns the rendering.
export function StatusChip({ label, tone, className }: StatusChipProps) {
  return (
    <span
      className={cn(
        "inline-flex w-fit items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium",
        toneClasses[tone],
        className,
      )}
    >
      {label}
    </span>
  );
}
