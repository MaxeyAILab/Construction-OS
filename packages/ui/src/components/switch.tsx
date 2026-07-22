"use client";

import * as SwitchPrimitive from "@radix-ui/react-switch";
import { forwardRef } from "react";
import { cn } from "../lib/cn";

export const Switch = forwardRef<
  React.ElementRef<typeof SwitchPrimitive.Root>,
  React.ComponentPropsWithoutRef<typeof SwitchPrimitive.Root>
>(({ className, ...props }, ref) => (
  <SwitchPrimitive.Root
    ref={ref}
    className={cn(
      "peer inline-flex h-5 w-9 shrink-0 items-center rounded-full border border-transparent",
      "bg-neutral-300 transition-colors duration-fast ease-out focus-visible:outline-none focus-visible:ring-2",
      "focus-visible:ring-brand-600 focus-visible:ring-offset-1 disabled:cursor-not-allowed disabled:opacity-40",
      "data-[state=checked]:bg-brand",
      className,
    )}
    {...props}
  >
    <SwitchPrimitive.Thumb
      className={cn(
        "pointer-events-none block size-4 rounded-full bg-neutral-0 shadow-elev-1",
        "transition-transform duration-fast ease-out translate-x-0.5 data-[state=checked]:translate-x-[18px]",
      )}
    />
  </SwitchPrimitive.Root>
));
Switch.displayName = "Switch";
