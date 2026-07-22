"use client";

import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import { Loader2 } from "lucide-react";
import { forwardRef } from "react";
import { cn } from "../lib/cn";

// ui-design-system.md §3.1. Sizes are the documented touch-target scale
// (sm 28 / md 36 / lg 44 / field 52 — field meets NFR-20's >=48px minimum
// for gloved, one-handed field use).
const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-medium " +
    "transition-colors duration-fast ease-out focus-visible:outline-none focus-visible:ring-2 " +
    "focus-visible:ring-brand-600 focus-visible:ring-offset-1 disabled:pointer-events-none disabled:opacity-40",
  {
    variants: {
      variant: {
        primary: "bg-brand text-white hover:bg-brand-700 active:bg-brand-800",
        secondary:
          "border border-neutral-200 bg-neutral-0 text-neutral-900 hover:bg-neutral-50 active:bg-neutral-100",
        ghost: "text-neutral-700 hover:bg-neutral-100 active:bg-neutral-200",
        danger: "bg-danger-600 text-white hover:bg-danger-700 active:bg-danger-700",
        ai: "bg-ai-50 text-ai-700 hover:bg-ai-100 active:bg-ai-200",
      },
      size: {
        sm: "h-[28px] px-3 text-xs [&_svg]:size-4",
        md: "h-[36px] px-4 [&_svg]:size-4",
        lg: "h-[44px] px-5 text-md [&_svg]:size-5",
        field: "h-[52px] px-6 text-md [&_svg]:size-5",
      },
    },
    defaultVariants: {
      variant: "primary",
      size: "md",
    },
  },
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean;
  loading?: boolean;
}

// Loading swaps the label for a spinner but keeps the button's width fixed
// (measured via a hidden duplicate of the content) so nothing shifts.
export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild, loading, disabled, children, ...props }, ref) => {
    const Comp = asChild ? Slot : "button";
    return (
      <Comp
        ref={ref}
        className={cn(buttonVariants({ variant, size }), className)}
        disabled={disabled ?? loading}
        aria-busy={loading}
        {...props}
      >
        {loading ? (
          <span className="relative inline-flex items-center justify-center gap-2">
            {/* opacity-0 (not `invisible`/visibility:hidden) keeps this in the
                accessible-name computation — a loading button with only an
                aria-hidden spinner would otherwise announce no name at all. */}
            <span className="opacity-0 inline-flex items-center gap-2">{children}</span>
            <Loader2 className="absolute size-4 animate-spin" aria-hidden="true" />
          </span>
        ) : (
          children
        )}
      </Comp>
    );
  },
);
Button.displayName = "Button";
