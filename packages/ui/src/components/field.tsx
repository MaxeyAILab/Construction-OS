"use client";

import { useId } from "react";
import { cn } from "../lib/cn";
import { Label } from "./label";

export interface FieldProps {
  label: string;
  helperText?: string;
  error?: string;
  required?: boolean;
  htmlFor?: string;
  children: (ids: { inputId: string; describedBy: string | undefined }) => React.ReactNode;
  className?: string;
}

// ui-design-system.md §3.2: "label always visible above (never
// placeholder-as-label), 13px helper/error text below." One structural
// contract shared by every form input variant so that rule can't drift
// per-field.
export function Field({ label, helperText, error, required, children, className }: FieldProps) {
  const inputId = useId();
  const helperId = `${inputId}-helper`;
  const errorId = `${inputId}-error`;
  const describedBy = error ? errorId : helperText ? helperId : undefined;

  return (
    <div className={cn("flex flex-col gap-1.5", className)}>
      <Label htmlFor={inputId}>
        {label}
        {required && (
          <span className="text-danger-600" aria-hidden="true">
            {" "}
            *
          </span>
        )}
      </Label>
      {children({ inputId, describedBy })}
      {error ? (
        <p id={errorId} className="text-sm text-danger-600" role="alert">
          {error}
        </p>
      ) : helperText ? (
        <p id={helperId} className="text-sm text-neutral-500">
          {helperText}
        </p>
      ) : null}
    </div>
  );
}
