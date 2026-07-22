"use client";

import { Toast, ToastClose, ToastDescription, ToastProvider, ToastTitle, ToastViewport } from "./toast";
import { dismissToast, useToasts } from "./use-toast";

/** Mount once near the app root; call `toast({ title, description, tone })` from anywhere. */
export function Toaster() {
  const toasts = useToasts();

  return (
    <ToastProvider swipeDirection="right">
      {toasts.map(({ id, title, description, tone }) => (
        <Toast key={id} tone={tone} onOpenChange={(open) => !open && dismissToast(id)}>
          <div className="flex-1">
            <ToastTitle>{title}</ToastTitle>
            {description && <ToastDescription>{description}</ToastDescription>}
          </div>
          <ToastClose />
        </Toast>
      ))}
      <ToastViewport />
    </ToastProvider>
  );
}
