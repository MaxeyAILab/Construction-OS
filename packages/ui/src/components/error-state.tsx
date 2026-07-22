import { AlertTriangle } from "lucide-react";
import { cn } from "../lib/cn";
import { Button } from "./button";
import { Card } from "./card";

export interface ErrorStateProps {
  variant?: "inline" | "section" | "page";
  message: string;
  traceId?: string;
  onRetry?: () => void;
  supportHref?: string;
  className?: string;
}

// ui-design-system.md §6: "Never a dead end — always retry or path out."
export function ErrorState({
  variant = "section",
  message,
  traceId,
  onRetry,
  supportHref,
  className,
}: ErrorStateProps) {
  if (variant === "inline") {
    return (
      <p className={cn("flex items-center gap-1.5 text-sm text-danger-600", className)} role="alert">
        <AlertTriangle className="size-4 shrink-0" />
        {message}
      </p>
    );
  }

  const body = (
    <div className="flex flex-col items-center gap-3 text-center">
      <AlertTriangle className="size-6 text-danger-600" />
      <p className="text-sm text-neutral-900">{message}</p>
      {traceId && <p className="text-xs text-neutral-500">Trace ID: {traceId}</p>}
      <div className="flex items-center gap-3 pt-1">
        {onRetry && (
          <Button variant="secondary" size="sm" onClick={onRetry}>
            Retry
          </Button>
        )}
        {supportHref && (
          <a href={supportHref} className="text-sm text-brand hover:underline">
            Contact support
          </a>
        )}
      </div>
    </div>
  );

  if (variant === "page") {
    return (
      <div className={cn("flex min-h-[60vh] items-center justify-center px-6", className)} role="alert">
        {body}
      </div>
    );
  }

  return (
    <Card className={cn("flex items-center justify-center py-8", className)} role="alert">
      {body}
    </Card>
  );
}
