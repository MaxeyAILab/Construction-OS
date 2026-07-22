"use client";

import { useSyncExternalStore } from "react";

export interface ToastItem {
  id: string;
  title: string;
  description?: string;
  tone?: "neutral" | "success" | "danger";
}

type Listener = () => void;

let toasts: ToastItem[] = [];
const listeners = new Set<Listener>();

function emit(): void {
  for (const listener of listeners) listener();
}

function subscribe(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function getSnapshot(): ToastItem[] {
  return toasts;
}

export function toast(item: Omit<ToastItem, "id">): string {
  const id = crypto.randomUUID();
  toasts = [...toasts, { ...item, id }];
  emit();
  return id;
}

export function dismissToast(id: string): void {
  toasts = toasts.filter((t) => t.id !== id);
  emit();
}

// Module-level store (not React context) so `toast()` can be called from
// anywhere — event handlers, non-component code — the same way
// window.alert() can, without needing a hook or provider reference at the
// call site. <Toaster/> (mounted once near the app root) is the only
// consumer of useToasts().
export function useToasts(): ToastItem[] {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}
