"use client";

import { forwardRef, useEffect, useState } from "react";
import { cn } from "../lib/cn";
import { Input, type InputProps } from "./input";

export interface CurrencyInputProps extends Omit<InputProps, "type" | "onChange" | "value"> {
  /** Exact decimal string, e.g. "1200.00" (CLAUDE.md: money is never a float). */
  value: string;
  onValueChange: (value: string) => void;
  currencySymbol?: string;
  locale?: string;
}

const shorthandSuffixes: Record<string, number> = { k: 1_000, m: 1_000_000 };

// ui-design-system.md §3.2: "right-aligned tabular numerals, currency
// prefix from tenant locale, accepts '1.2k'->1,200 shorthand." Formats
// on blur (thousands separators, 2dp) and shows the raw editable value
// while focused — parses to an exact 2-decimal string, never a float, so
// the value handed back always satisfies packages/schemas' moneyAmountSchema.
export const CurrencyInput = forwardRef<HTMLInputElement, CurrencyInputProps>(
  (
    { value, onValueChange, currencySymbol = "$", locale = "en-US", className, ...props },
    ref,
  ) => {
    const [raw, setRaw] = useState(value);
    const [focused, setFocused] = useState(false);

    useEffect(() => {
      if (!focused) setRaw(formatDisplay(value, locale));
    }, [value, focused, locale]);

    return (
      <div className="relative">
        <span
          className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-sm text-neutral-500"
          aria-hidden="true"
        >
          {currencySymbol}
        </span>
        <Input
          ref={ref}
          type="text"
          inputMode="decimal"
          value={raw}
          onFocus={(e) => {
            setFocused(true);
            setRaw(value);
            props.onFocus?.(e);
          }}
          onChange={(e) => setRaw(e.target.value)}
          onBlur={(e) => {
            setFocused(false);
            const parsed = parseMoneyInput(raw);
            onValueChange(parsed);
            setRaw(formatDisplay(parsed, locale));
            props.onBlur?.(e);
          }}
          className={cn("pl-7 text-right tabular-nums", className)}
          {...props}
        />
      </div>
    );
  },
);
CurrencyInput.displayName = "CurrencyInput";

/** Parses free-typed input (including "1.2k"/"3m" shorthand) to a "-?\d+\.\d{2}" string. */
export function parseMoneyInput(input: string): string {
  const trimmed = input.trim().toLowerCase().replace(/,/g, "");
  if (trimmed === "") return "0.00";

  const negative = trimmed.startsWith("-");
  const unsigned = negative ? trimmed.slice(1) : trimmed;
  const suffixMatch = /^([\d.]+)([km])$/.exec(unsigned);

  let n: number;
  if (suffixMatch) {
    n = Number.parseFloat(suffixMatch[1]!) * shorthandSuffixes[suffixMatch[2]!]!;
  } else {
    n = Number.parseFloat(unsigned);
  }
  if (!Number.isFinite(n)) return "0.00";

  const magnitude = (Math.round(n * 100) / 100).toFixed(2);
  return negative ? `-${magnitude}` : magnitude;
}

function formatDisplay(decimalString: string, locale: string): string {
  const n = Number.parseFloat(decimalString);
  if (!Number.isFinite(n)) return decimalString;
  return new Intl.NumberFormat(locale, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(n);
}
