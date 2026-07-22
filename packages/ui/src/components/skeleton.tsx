import { cn } from "../lib/cn";

// ui-design-system.md §6: "skeletons mirroring final layout (shimmer
// 1.2s loop) — never spinners on content areas." Callers compose this
// primitive into the shape of the real content (e.g. a row of Skeletons
// matching a table row) rather than showing a generic block.
export function Skeleton({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      role="status"
      aria-label="Loading"
      className={cn("animate-shimmer rounded-sm bg-neutral-100", className)}
      {...props}
    />
  );
}
