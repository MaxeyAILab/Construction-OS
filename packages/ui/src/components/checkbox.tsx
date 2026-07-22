"use client";

import * as CheckboxPrimitive from "@radix-ui/react-checkbox";
import { Check } from "lucide-react";
import { forwardRef } from "react";
import { cn } from "../lib/cn";

export const Checkbox = forwardRef<
  React.ElementRef<typeof CheckboxPrimitive.Root>,
  React.ComponentPropsWithoutRef<typeof CheckboxPrimitive.Root>
>(({ className, ...props }, ref) => (
  <CheckboxPrimitive.Root
    ref={ref}
    className={cn(
      "flex size-4 shrink-0 items-center justify-center rounded-sm border border-neutral-300 bg-neutral-0",
      "transition-colors duration-fast ease-out focus-visible:outline-none focus-visible:ring-2",
      "focus-visible:ring-brand-600 focus-visible:ring-offset-1 disabled:cursor-not-allowed disabled:opacity-40",
      "data-[state=checked]:border-brand data-[state=checked]:bg-brand",
      className,
    )}
    {...props}
  >
    <CheckboxPrimitive.Indicator className="text-white">
      <Check className="size-3" strokeWidth={3} />
    </CheckboxPrimitive.Indicator>
  </CheckboxPrimitive.Root>
));
Checkbox.displayName = "Checkbox";
