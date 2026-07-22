"use client";

import { forwardRef } from "react";
import { cn } from "../lib/cn";

export interface TextareaProps extends React.TextareaHTMLAttributes<HTMLTextAreaElement> {
  invalid?: boolean;
}

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(
  ({ className, invalid, ...props }, ref) => (
    <textarea
      ref={ref}
      aria-invalid={invalid ?? undefined}
      className={cn(
        "min-h-20 w-full rounded-sm border bg-neutral-0 px-3 py-2 text-sm text-neutral-900",
        "placeholder:text-neutral-500 transition-colors duration-fast ease-out focus-visible:outline-none",
        "focus-visible:ring-2 focus-visible:ring-offset-1 disabled:cursor-not-allowed disabled:opacity-40",
        invalid
          ? "border-danger-600 focus-visible:ring-danger-600"
          : "border-neutral-200 focus-visible:ring-brand-600",
        className,
      )}
      {...props}
    />
  ),
);
Textarea.displayName = "Textarea";
