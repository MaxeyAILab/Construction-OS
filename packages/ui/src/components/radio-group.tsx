"use client";

import * as RadioGroupPrimitive from "@radix-ui/react-radio-group";
import { forwardRef } from "react";
import { cn } from "../lib/cn";

export const RadioGroup = RadioGroupPrimitive.Root;

export const RadioGroupItem = forwardRef<
  React.ElementRef<typeof RadioGroupPrimitive.Item>,
  React.ComponentPropsWithoutRef<typeof RadioGroupPrimitive.Item>
>(({ className, ...props }, ref) => (
  <RadioGroupPrimitive.Item
    ref={ref}
    className={cn(
      "flex size-4 shrink-0 items-center justify-center rounded-full border border-neutral-300 bg-neutral-0",
      "transition-colors duration-fast ease-out focus-visible:outline-none focus-visible:ring-2",
      "focus-visible:ring-brand-600 focus-visible:ring-offset-1 disabled:cursor-not-allowed disabled:opacity-40",
      "data-[state=checked]:border-brand",
      className,
    )}
    {...props}
  >
    <RadioGroupPrimitive.Indicator className="size-2 rounded-full bg-brand" />
  </RadioGroupPrimitive.Item>
));
RadioGroupItem.displayName = "RadioGroupItem";
