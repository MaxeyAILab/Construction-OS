"use client";

import { forwardRef } from "react";
import { cn } from "../lib/cn";
import { Input, type InputProps } from "./input";

export interface NumberInputProps extends Omit<InputProps, "type" | "onChange" | "value"> {
  value: string;
  onValueChange: (value: string) => void;
}

// Quantities are also exact decimal strings over the wire (CLAUDE.md,
// packages/schemas' quantitySchema) — this stays a text input rather than
// type="number" so the value is never silently coerced through a JS
// float, and tabular numerals keep columns of quantities aligned.
export const NumberInput = forwardRef<HTMLInputElement, NumberInputProps>(
  ({ value, onValueChange, className, inputMode = "decimal", ...props }, ref) => (
    <Input
      ref={ref}
      type="text"
      inputMode={inputMode}
      value={value}
      onChange={(e) => onValueChange(e.target.value)}
      className={cn("text-right tabular-nums", className)}
      {...props}
    />
  ),
);
NumberInput.displayName = "NumberInput";
