"use client";

import { createContext, useContext, useState, useRef, useCallback, useEffect, ReactNode } from "react";

// ==========================================
// 共通トーストシステム
// success / error の通知に加え、「元に戻す」アクション付きトーストに対応
// （提供完了の誤タップ復帰などに利用）
// ==========================================
type ToastType = "success" | "error" | "info";

interface ToastState {
  id: number;
  message: string;
  type: ToastType;
  action?: { label: string; onClick: () => void };
}

interface ToastApi {
  showToast: (message: string, type?: ToastType) => void;
  showError: (message: string) => void;
  showUndo: (message: string, onUndo: () => void) => void;
}

const ToastContext = createContext<ToastApi | null>(null);

export function useToast(): ToastApi {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error("useToast must be used within <ToastProvider>");
  return ctx;
}

const DOT: Record<ToastType, string> = {
  success: "bg-emerald-400",
  error: "bg-red-400",
  info: "bg-stone-400",
};

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toast, setToast] = useState<ToastState | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearTimer = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const dismiss = useCallback(() => {
    clearTimer();
    setToast(null);
  }, [clearTimer]);

  const push = useCallback(
    (t: Omit<ToastState, "id">, duration: number) => {
      clearTimer();
      setToast({ ...t, id: Date.now() });
      timerRef.current = setTimeout(() => {
        setToast(null);
        timerRef.current = null;
      }, duration);
    },
    [clearTimer]
  );

  const showToast = useCallback((message: string, type: ToastType = "success") => push({ message, type }, 3000), [push]);
  const showError = useCallback((message: string) => push({ message, type: "error" }, 3500), [push]);
  const showUndo = useCallback(
    (message: string, onUndo: () => void) => {
      push(
        {
          message,
          type: "info",
          action: {
            label: "元に戻す",
            onClick: () => {
              onUndo();
              dismiss();
            },
          },
        },
        6000
      );
    },
    [push, dismiss]
  );

  useEffect(() => () => clearTimer(), [clearTimer]);

  return (
    <ToastContext.Provider value={{ showToast, showError, showUndo }}>
      {children}
      <div className="fixed inset-x-0 bottom-6 z-[100] flex justify-center px-4 pointer-events-none">
        {toast && (
          <div
            key={toast.id}
            className="pointer-events-auto flex items-center gap-3 rounded-xl bg-stone-900 text-white pl-4 pr-2.5 py-3 shadow-xl border border-white/10 animate-[toastIn_0.22s_ease-out]"
          >
            <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${DOT[toast.type]}`} />
            <span className="text-sm font-medium">{toast.message}</span>
            {toast.action && (
              <button
                onClick={toast.action.onClick}
                className="ml-1 rounded-md border border-white/20 hover:bg-white/10 px-2.5 py-1 text-xs font-semibold tracking-wide transition-colors"
              >
                {toast.action.label}
              </button>
            )}
            <button onClick={dismiss} className="ml-0.5 w-6 h-6 flex items-center justify-center rounded-md text-white/50 hover:text-white hover:bg-white/10 text-lg leading-none" aria-label="閉じる">
              ×
            </button>
          </div>
        )}
      </div>
    </ToastContext.Provider>
  );
}
