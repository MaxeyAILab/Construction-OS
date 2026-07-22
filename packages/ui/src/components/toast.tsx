"use client";

import * as ToastPrimitive from "@radix-ui/react-toast";
import { X } from "lucide-react";
import { forwardRef } from "react";
import { cn } from "../lib/cn";

export const ToastProvider = ToastPrimitive.Provider;

export const ToastViewport = forwardRef<
  React.ElementRef<typeof ToastPrimitive.Viewport>,
  React.ComponentPropsWithoutRef<typeof ToastPrimitive.Viewport>
>(({ className, ...props }, ref) => (
  <ToastPrimitive.Viewport
    ref={ref}
    className={cn(
      "fixed bottom-0 right-0 z-50 flex w-full max-w-sm flex-col gap-2 p-4 outline-none",
      className,
    )}
    {...props}
  />
));
ToastViewport.displayName = "ToastViewport";

const toneClasses = {
  neutral: "border-neutral-200 bg-neutral-0",
  success: "border-success-600/20 bg-success-50",
  danger: "border-danger-600/20 bg-danger-50",
} as const;

export interface ToastRootProps extends React.ComponentPropsWithoutRef<typeof ToastPrimitive.Root> {
  tone?: keyof typeof toneClasses | undefined;
}

export const Toast = forwardRef<React.ElementRef<typeof ToastPrimitive.Root>, ToastRootProps>(
  ({ className, tone = "neutral", ...props }, ref) => (
    <ToastPrimitive.Root
      ref={ref}
      className={cn(
        "relative flex items-start gap-3 rounded-md border p-4 shadow-elev-2",
        "data-[state=open]:animate-in data-[state=open]:slide-in-from-bottom data-[state=open]:duration-slow",
        "data-[state=closed]:animate-out data-[state=closed]:fade-out data-[state=closed]:duration-base",
        "data-[swipe=end]:animate-out",
        toneClasses[tone],
        className,
      )}
      {...props}
    />
  ),
);
Toast.displayName = "Toast";

export const ToastTitle = forwardRef<
  React.ElementRef<typeof ToastPrimitive.Title>,
  React.ComponentPropsWithoutRef<typeof ToastPrimitive.Title>
>(({ className, ...props }, ref) => (
  <ToastPrimitive.Title ref={ref} className={cn("text-sm font-medium text-neutral-900", className)} {...props} />
));
ToastTitle.displayName = "ToastTitle";

export const ToastDescription = forwardRef<
  React.ElementRef<typeof ToastPrimitive.Description>,
  React.ComponentPropsWithoutRef<typeof ToastPrimitive.Description>
>(({ className, ...props }, ref) => (
  <ToastPrimitive.Description ref={ref} className={cn("text-sm text-neutral-500", className)} {...props} />
));
ToastDescription.displayName = "ToastDescription";

export const ToastClose = forwardRef<
  React.ElementRef<typeof ToastPrimitive.Close>,
  React.ComponentPropsWithoutRef<typeof ToastPrimitive.Close>
>(({ className, ...props }, ref) => (
  <ToastPrimitive.Close
    ref={ref}
    className={cn(
      "absolute right-2 top-2 rounded-sm text-neutral-500 transition-colors duration-fast",
      "hover:text-neutral-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600",
      className,
    )}
    {...props}
  >
    <X className="size-4" />
  </ToastPrimitive.Close>
));
ToastClose.displayName = "ToastClose";
