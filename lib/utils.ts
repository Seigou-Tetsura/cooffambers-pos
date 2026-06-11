import { CartItem } from "./types";

// ==========================================
// 共通ロジック関数（Utils）
// ==========================================

// 全角数字・記号混じりの入力を安全に整数化
export const parseToNumber = (val: string | number | null | undefined): number => {
  if (val === undefined || val === null) return 0;
  const halfVal = String(val).replace(/[０-９]/g, (s) => String.fromCharCode(s.charCodeAt(0) - 0xfee0));
  const numStr = halfVal.replace(/[^0-9]/g, "");
  const num = parseInt(numStr, 10);
  return isNaN(num) ? 0 : num;
};

export interface GroupedItem {
  total: number;
  subItems: CartItem[];
}

// 同名商品をまとめ、温度ごとの内訳を保持
export const groupOrderItems = (items: CartItem[] | undefined): Record<string, GroupedItem> => {
  if (!items) return {};
  return items.reduce((acc, item) => {
    if (!acc[item.name]) acc[item.name] = { total: 0, subItems: [] };
    acc[item.name].total += item.quantity;
    if (item.temperature) acc[item.name].subItems.push(item);
    return acc;
  }, {} as Record<string, GroupedItem>);
};

// CSV 破損防止のためのエスケープ
export const escapeCsv = (str: string | number) => `"${String(str).replace(/"/g, '""')}"`;

// 経過秒数を人が読める表記に
export const formatElapsed = (seconds: number): string => {
  const s = Math.max(0, Math.floor(seconds));
  if (s < 60) return `${s}秒`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}分`;
  const h = Math.floor(m / 60);
  return `${h}時間${m % 60}分`;
};

// 経過時間に応じた警告レベル（バリスタ画面の色分け用）
export type UrgencyLevel = "normal" | "warn" | "danger";
export const elapsedUrgency = (seconds: number): UrgencyLevel => {
  if (seconds >= 600) return "danger"; // 10分以上
  if (seconds >= 300) return "warn"; // 5分以上
  return "normal";
};
