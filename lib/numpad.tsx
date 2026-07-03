"use client";

import { useEffect, useCallback } from "react";

// ==========================================
// 画面内テンキー（NumPad）
// iPadOS には iPhone のような 3×4 の OS 標準テンキーが存在せず、
// inputMode="numeric" を指定してもフルキーボードが開いてしまう。
// ピーク時の入力スピードを確保するため、アプリ内にテンキーを持つ。
// ==========================================

const KEYS = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "00", "0", "⌫"] as const;
const MAX_DIGITS = 7; // 桁あふれ防止（〜999万円まで）

export function NumPad({
  title,
  value,
  prefix,
  onChange,
  onClose,
}: {
  title: string;
  value: string;
  prefix?: string; // 表示用の接頭辞（"¥" など）
  onChange: (next: string) => void;
  onClose: () => void;
}) {
  const press = useCallback(
    (key: string) => {
      if (key === "⌫") {
        onChange(value.slice(0, -1));
        return;
      }
      const next = (value + key).replace(/^0+(?=\d)/, ""); // 先頭の余分な 0 は落とす
      if (next.length <= MAX_DIGITS) onChange(next);
    },
    [value, onChange]
  );

  // 物理キーボード（Bluetoothテンキー含む）でもそのまま入力できるように
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (/^\d$/.test(e.key)) {
        e.preventDefault();
        press(e.key);
      } else if (e.key === "Backspace") {
        e.preventDefault();
        press("⌫");
      } else if (e.key === "Enter" || e.key === "Escape") {
        e.preventDefault();
        onClose();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [press, onClose]);

  return (
    <div className="fixed inset-0 z-[60] flex items-end sm:items-center justify-center" onClick={onClose}>
      <div className="absolute inset-0 bg-stone-900/25" />
      <div
        className="relative bg-white w-full sm:w-[340px] rounded-t-2xl sm:rounded-2xl shadow-xl border border-stone-200 p-5 pb-7 sm:pb-5"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex justify-between items-baseline mb-3">
          <span className="text-[11px] font-semibold uppercase tracking-[0.12em] text-stone-400">{title}</span>
          <span className="text-3xl font-semibold tnum text-stone-900 min-h-[36px]">
            {prefix && <span className="text-stone-400 text-xl mr-0.5">{prefix}</span>}
            {value === "" ? <span className="text-stone-300">0</span> : Number(value).toLocaleString()}
          </span>
        </div>

        <div className="grid grid-cols-3 gap-2">
          {KEYS.map((key) => (
            <button
              key={key}
              onClick={() => press(key)}
              className="py-4 text-xl font-semibold tnum rounded-lg border border-stone-200 bg-white text-stone-800 hover:bg-stone-50 active:scale-[0.97] active:bg-stone-100 transition-all select-none"
            >
              {key}
            </button>
          ))}
        </div>

        <div className="grid grid-cols-2 gap-2 mt-2">
          <button
            onClick={() => onChange("")}
            className="py-3 text-sm font-semibold rounded-lg border border-stone-300 text-stone-500 hover:bg-red-50 hover:text-red-600 hover:border-red-200 active:scale-[0.97] transition-all"
          >
            クリア
          </button>
          <button
            onClick={onClose}
            className="py-3 text-sm font-semibold rounded-lg bg-stone-900 text-white hover:bg-stone-800 active:scale-[0.97] transition-all"
          >
            確定
          </button>
        </div>
      </div>
    </div>
  );
}
