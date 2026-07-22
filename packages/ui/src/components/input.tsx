"use client";

import { cva, type VariantProps } from "class-variance-authority";
import { forwardRef } from "react";
import { cn } from "../lib/cn";

// ui-design-system.md §3.2: 36px default, 52px field mode; hairline
// border; 2px brand focus ring with 1px offset; error state swaps the
// border/ring to danger (paired with icon+text elsewhere, never color
// alone — NFR-18).
export const inputVariants = cva(
  "w-full rounded-sm border bg-neutral-0 px-3 text-sm text-neutral-900 placeholder:text-neutral-500 " +
    "transition-colors duration-fast ease-out focus-visible:outline-none focus-visible:ring-2 " +
    "focus-visible:ring-offset-1 disabled:cursor-not-allowed disabled:opacity-40",
  {
    variants: {
      fieldSize: {
        default: "h-9",
        field: "h-[52px] text-md",
      },
      invalid: {
        true: "border-danger-600 focus-visible:ring-danger-600",
        false: "border-neutral-200 focus-visible:ring-brand-600",
      },
    },
    defaultVariants: {
      fieldSize: "default",
      invalid: false,
    },
  },
);

export interface InputProps
  extends Omit<React.InputHTMLAttributes<HTMLInputElement>, "size">,
    VariantProps<typeof inputVariants> {}

export const Input = forwardRef<HTMLInputElement, InputProps>(
  ({ className, fieldSize, invalid, ...props }, ref) => (
    <input
      ref={ref}
      className={cn(inputVariants({ fieldSize, invalid }), className)}
      aria-invalid={invalid ?? undefined}
      {...props}
    />
  ),
);
Input.displayName = "Input";
