import { CartItem, Order } from "./types";

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

// ==========================================
// 平均オーダー完了時間（受注 createdAt → 提供 completedAt）
// ==========================================
export interface CompletionStats {
  avgSec: number | null; // 全体の平均（秒）。データが無ければ null
  count: number; // 計測対象（完了かつ両時刻あり）の件数
  byHourAvg: Record<number, number>; // 受注時刻の時間帯(0-23) -> 平均秒
  byHourCount: Record<number, number>; // 時間帯ごとの件数
}

export function computeCompletion(orders: Order[], opts?: { sinceMs?: number }): CompletionStats {
  let total = 0;
  let n = 0;
  const sum: Record<number, number> = {};
  const cnt: Record<number, number> = {};

  for (const o of orders) {
    if (o.status !== "completed" || !o.createdAt || !o.completedAt) continue;
    // 直近◯分など、完了時刻で期間を絞り込む（opts.sinceMs 以降のみ集計）
    if (opts?.sinceMs !== undefined && o.completedAt.seconds * 1000 < opts.sinceMs) continue;
    const dur = o.completedAt.seconds - o.createdAt.seconds;
    if (dur < 0) continue;
    total += dur;
    n += 1;
    const h = new Date(o.createdAt.seconds * 1000).getHours();
    sum[h] = (sum[h] || 0) + dur;
    cnt[h] = (cnt[h] || 0) + 1;
  }

  const byHourAvg: Record<number, number> = {};
  for (const h in sum) byHourAvg[Number(h)] = Math.round(sum[h] / cnt[h]);

  return { avgSec: n > 0 ? Math.round(total / n) : null, count: n, byHourAvg, byHourCount: cnt };
}
