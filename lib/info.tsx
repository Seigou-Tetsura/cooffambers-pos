"use client";

import { useState, useRef, useEffect } from "react";

// ==========================================
// ⓘ 説明ツールチップ
// 押すと簡単な説明が出る小さな情報マーク。各項目の横に置いて使う
// ==========================================
export function InfoTip({ text, align = "center" }: { text: string; align?: "left" | "center" | "right" }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  const pos = align === "left" ? "left-0" : align === "right" ? "right-0" : "left-1/2 -translate-x-1/2";

  return (
    <span ref={ref} className="relative inline-flex align-middle">
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          e.preventDefault();
          setOpen((v) => !v);
        }}
        className="inline-flex items-center justify-center w-4 h-4 rounded-full bg-neutral-200 text-neutral-500 text-[10px] font-black leading-none hover:bg-neutral-300 transition-colors"
        aria-label="説明を表示"
      >
        i
      </button>
      {open && (
        <span
          className={`absolute z-[80] top-6 ${pos} w-56 max-w-[70vw] bg-stone-800 text-white text-[11px] font-medium leading-relaxed rounded-lg px-3 py-2 shadow-xl whitespace-normal text-left`}
        >
          {text}
        </span>
      )}
    </span>
  );
}
