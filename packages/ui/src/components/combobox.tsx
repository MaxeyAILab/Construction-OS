"use client";

import * as PopoverPrimitive from "@radix-ui/react-popover";
import { Command as CommandPrimitive } from "cmdk";
import { Check, ChevronDown } from "lucide-react";
import { useState } from "react";
import { cn } from "../lib/cn";

export interface ComboboxOption {
  value: string;
  label: string;
}

export interface ComboboxProps {
  options: ComboboxOption[];
  value: string | null;
  onValueChange: (value: string) => void;
  placeholder?: string;
  emptyText?: string;
  /** "+ New supplier" style inline creation (§3.2, "create-inline where domain allows"). */
  onCreate?: (query: string) => void;
  createLabel?: (query: string) => string;
  className?: string;
}

// ui-design-system.md §3.2: "searchable at >7 options; recent + frequent
// items float to top" — ordering recent/frequent items is a caller
// concern (they control `options` order); this component owns search +
// selection + optional inline creation.
export function Combobox({
  options,
  value,
  onValueChange,
  placeholder = "Select…",
  emptyText = "No results",
  onCreate,
  createLabel = (q) => `+ New "${q}"`,
  className,
}: ComboboxProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const selected = options.find((o) => o.value === value);

  return (
    <PopoverPrimitive.Root open={open} onOpenChange={setOpen}>
      <PopoverPrimitive.Trigger asChild>
        <button
          type="button"
          role="combobox"
          aria-expanded={open}
          className={cn(
            "flex h-9 w-full items-center justify-between gap-2 rounded-sm border border-neutral-200",
            "bg-neutral-0 px-3 text-sm transition-colors duration-fast ease-out focus-visible:outline-none",
            "focus-visible:ring-2 focus-visible:ring-brand-600 focus-visible:ring-offset-1",
            selected ? "text-neutral-900" : "text-neutral-500",
            className,
          )}
        >
          {selected?.label ?? placeholder}
          <ChevronDown className="size-4 shrink-0 text-neutral-500" />
        </button>
      </PopoverPrimitive.Trigger>
      <PopoverPrimitive.Portal>
        <PopoverPrimitive.Content
          align="start"
          sideOffset={4}
          className="z-50 w-[var(--radix-popover-trigger-width)] rounded-md border border-neutral-200 bg-neutral-0 shadow-elev-2"
        >
          <CommandPrimitive shouldFilter={true}>
            <CommandPrimitive.Input
              value={query}
              onValueChange={setQuery}
              placeholder="Search…"
              className="w-full border-b border-neutral-200 px-3 py-2 text-sm outline-none placeholder:text-neutral-500"
            />
            <CommandPrimitive.List className="max-h-64 overflow-y-auto p-1">
              <CommandPrimitive.Empty className="px-3 py-2 text-sm text-neutral-500">
                {onCreate && query ? (
                  <button
                    type="button"
                    className="w-full rounded-sm px-2 py-1.5 text-left text-sm text-brand hover:bg-neutral-100"
                    onClick={() => {
                      onCreate(query);
                      setOpen(false);
                      setQuery("");
                    }}
                  >
                    {createLabel(query)}
                  </button>
                ) : (
                  emptyText
                )}
              </CommandPrimitive.Empty>
              {options.map((option) => (
                <CommandPrimitive.Item
                  key={option.value}
                  value={option.label}
                  onSelect={() => {
                    onValueChange(option.value);
                    setOpen(false);
                    setQuery("");
                  }}
                  className={cn(
                    "flex cursor-default items-center gap-2 rounded-sm px-2 py-1.5 text-sm text-neutral-900",
                    "data-[selected=true]:bg-neutral-100",
                  )}
                >
                  <Check
                    className={cn(
                      "size-4 text-brand",
                      option.value === value ? "opacity-100" : "opacity-0",
                    )}
                  />
                  {option.label}
                </CommandPrimitive.Item>
              ))}
            </CommandPrimitive.List>
          </CommandPrimitive>
        </PopoverPrimitive.Content>
      </PopoverPrimitive.Portal>
    </PopoverPrimitive.Root>
  );
}
