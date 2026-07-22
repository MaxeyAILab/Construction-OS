import { ArrowDown, ArrowUp } from "lucide-react";
import { cn } from "../lib/cn";
import { Card } from "./card";

export interface MetricCardProps {
  label: string;
  value: string;
  delta?: { value: string; direction: "up" | "down"; tone: "success" | "danger" | "neutral" };
  /** Slot for a chart (e.g. Recharts sparkline) — dataviz is a separate workstream. */
  sparkline?: React.ReactNode;
  className?: string;
}

const deltaToneClasses = {
  success: "bg-success-50 text-success-700",
  danger: "bg-danger-50 text-danger-700",
  neutral: "bg-neutral-100 text-neutral-700",
} as const;

// ui-design-system.md §3.4 metric card pattern: label -> value -> delta
// chip -> sparkline.
export function MetricCard({ label, value, delta, sparkline, className }: MetricCardProps) {
  const DeltaIcon = delta?.direction === "down" ? ArrowDown : ArrowUp;
  return (
    <Card className={cn("flex flex-col gap-2", className)}>
      <span className="text-sm text-neutral-500">{label}</span>
      <span className="text-2xl font-semibold tabular-nums text-neutral-900">{value}</span>
      {delta && (
        <span
          className={cn(
            "inline-flex w-fit items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium",
            deltaToneClasses[delta.tone],
          )}
        >
          <DeltaIcon className="size-3" />
          {delta.value}
        </span>
      )}
      {sparkline}
    </Card>
  );
}
