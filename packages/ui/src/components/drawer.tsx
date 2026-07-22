"use client";

import * as DialogPrimitive from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import { forwardRef } from "react";
import { cn } from "../lib/cn";
import { DialogOverlay } from "./dialog";

// ui-design-system.md §3.5: record detail-in-context (open a PO from a
// table without losing the table) — right-side 480/640px on desktop,
// full-height bottom sheet on mobile. Drag-to-dismiss + 50/90% snap
// points for the mobile sheet are a follow-up (needs a gesture library);
// this ships the static full-height sheet, still swipeable via the
// scrim/Esc/close-button paths Radix already provides.
export const Drawer = DialogPrimitive.Root;
export const DrawerTrigger = DialogPrimitive.Trigger;
export const DrawerClose = DialogPrimitive.Close;

export interface DrawerContentProps extends React.ComponentPropsWithoutRef<typeof DialogPrimitive.Content> {
  size?: "md" | "lg";
}

export const DrawerContent = forwardRef<React.ElementRef<typeof DialogPrimitive.Content>, DrawerContentProps>(
  ({ className, size = "md", children, ...props }, ref) => (
    <DialogPrimitive.Portal>
      <DialogOverlay />
      <DialogPrimitive.Content
        ref={ref}
        className={cn(
          "fixed inset-y-0 right-0 z-50 flex w-full flex-col border-l border-neutral-200 bg-neutral-0 p-6 shadow-elev-3",
          "focus:outline-none data-[state=open]:animate-in data-[state=open]:slide-in-from-right",
          "data-[state=open]:duration-slow data-[state=closed]:animate-out",
          "data-[state=closed]:slide-out-to-right data-[state=closed]:duration-base",
          "max-sm:inset-x-0 max-sm:top-auto max-sm:h-[90%] max-sm:rounded-t-lg max-sm:border-l-0",
          "max-sm:border-t max-sm:data-[state=open]:slide-in-from-bottom max-sm:data-[state=closed]:slide-out-to-bottom",
          size === "md" ? "sm:max-w-[480px]" : "sm:max-w-[640px]",
          className,
        )}
        {...props}
      >
        {children}
        <DialogPrimitive.Close
          className={cn(
            "absolute right-4 top-4 rounded-sm text-neutral-500 transition-colors duration-fast",
            "hover:text-neutral-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600",
          )}
        >
          <X className="size-4" />
          <span className="sr-only">Close</span>
        </DialogPrimitive.Close>
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  ),
);
DrawerContent.displayName = "DrawerContent";

export const DrawerHeader = ({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) => (
  <div className={cn("flex flex-col gap-1.5 pb-4", className)} {...props} />
);

export const DrawerTitle = forwardRef<
  React.ElementRef<typeof DialogPrimitive.Title>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Title>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Title
    ref={ref}
    className={cn("text-lg font-semibold text-neutral-900", className)}
    {...props}
  />
));
DrawerTitle.displayName = "DrawerTitle";

export const DrawerBody = ({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) => (
  <div className={cn("flex-1 overflow-y-auto", className)} {...props} />
);
