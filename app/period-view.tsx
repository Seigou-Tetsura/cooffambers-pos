"use client";

import { useState, useCallback, useMemo } from "react";
import { collection, query, where, getDocs } from "firebase/firestore";
import { db } from "../lib/firebase";
import { Order } from "../lib/types";
import { escapeCsv } from "../lib/utils";
import { useToast } from "../lib/toast";
import { InfoTip } from "../lib/info";

// ==========================================
// 期間集計（PeriodView）
// 複数日をまたいだ売上推移・合計・人気商品を一括集計（必要時のみ取得）
// ==========================================
const toDateStr = (d: Date) => d.toISOString().split("T")[0];

export default function PeriodView() {
  const { showError } = useToast();
  const today = useMemo(() => new Date(), []);
  const defaultFrom = useMemo(() => {
    const d = new Date();
    d.setDate(d.getDate() - 6);
    return toDateStr(d);
  }, []);

  const [from, setFrom] = useState(defaultFrom);
  const [to, setTo] = useState(toDateStr(today));
  const [loading, setLoading] = useState(false);
  const [orders, setOrders] = useState<Order[] | null>(null);

  const fetchRange = useCallback(async () => {
    if (from > to) {
      showError("開始日は終了日より前にしてください。");
      return;
    }
    setLoading(true);
    try {
      const q = query(collection(db, "orders"), where("date", ">=", from), where("date", "<=", to));
      const snap = await getDocs(q);
      const data: Order[] = [];
      snap.forEach((d) => data.push({ id: d.id, ...d.data() } as Order));
      setOrders(data);
    } catch (e) {
      console.error(e);
      showError("データの取得に失敗しました。");
    } finally {
      setLoading(false);
    }
  }, [from, to, showError]);

  // 集計（取消除く）
  const agg = useMemo(() => {
    if (!orders) return null;
    let totalSales = 0;
    let validCount = 0;
    const daily: Record<string, { sales: number; count: number }> = {};
    const ranking: Record<string, number> = {};

    for (const o of orders) {
      if (o.status === "cancelled") continue;
      validCount += 1;
      totalSales += o.totalPrice;
      if (!daily[o.date]) daily[o.date] = { sales: 0, count: 0 };
      daily[o.date].sales += o.totalPrice;
      daily[o.date].count += 1;
      o.items?.forEach((item) => {
        const label = item.temperature ? `${item.name} (${item.temperature})` : item.name;
        ranking[label] = (ranking[label] || 0) + item.quantity;
      });
    }

    const dailyArr = Object.entries(daily).sort((a, b) => a[0].localeCompare(b[0]));
    const maxDaily = Math.max(1, ...dailyArr.map((d) => d[1].sales));
    const rankingArr = Object.entries(ranking).sort((a, b) => b[1] - a[1]).slice(0, 10);
    const days = dailyArr.length;
    const avgPerDay = days > 0 ? Math.round(totalSales / days) : 0;

    return { totalSales, validCount, dailyArr, maxDaily, rankingArr, days, avgPerDay };
  }, [orders]);

  const handleExportCSV = () => {
    if (!agg || agg.dailyArr.length === 0) {
      showError("エクスポートするデータがありません。");
      return;
    }
    const headers = ["営業日", "注文数", "売上"];
    const rows = agg.dailyArr.map(([date, d]) => [escapeCsv(date), d.count, d.sales].join(","));
    rows.push([escapeCsv("合計"), agg.validCount, agg.totalSales].join(","));
    const csv = "﻿" + [headers.join(","), ...rows].join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.setAttribute("download", `期間集計_${from}_${to}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  const Stat = ({ label, value }: { label: string; value: string }) => (
    <div className="bg-white rounded-xl border border-stone-200 shadow-[0_1px_3px_rgba(40,33,26,0.05)] p-4">
      <div className="text-[10px] font-semibold uppercase tracking-[0.12em] text-stone-400 mb-1.5">{label}</div>
      <div className="text-xl sm:text-2xl font-semibold tnum text-stone-900">{value}</div>
    </div>
  );

  return (
    <div className="space-y-5">
      {/* 期間選択 */}
      <div className="bg-white rounded-xl border border-stone-200 shadow-[0_1px_3px_rgba(40,33,26,0.05)] p-5">
        <h3 className="text-[11px] font-semibold uppercase tracking-[0.12em] text-stone-400 mb-4 flex items-center gap-1.5">
          期間を指定して集計
          <InfoTip text="開始日と終了日を選んで「集計する」を押すと、その期間の売上をまとめて表示します。複数日の合計や1日ごとの推移、人気商品が分かります。" align="left" />
        </h3>
        <div className="flex flex-col sm:flex-row sm:items-end gap-3">
          <div className="flex-1">
            <label className="block text-xs text-stone-400 font-medium mb-1.5">開始日</label>
            <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="w-full border border-stone-300 rounded-md px-2.5 py-2 text-stone-800 bg-white font-medium tnum focus:outline-none focus:border-[#8a7390] focus:ring-2 focus:ring-[#8a7390]/15" />
          </div>
          <div className="flex-1">
            <label className="block text-xs text-stone-400 font-medium mb-1.5">終了日</label>
            <input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="w-full border border-stone-300 rounded-md px-2.5 py-2 text-stone-800 bg-white font-medium tnum focus:outline-none focus:border-[#8a7390] focus:ring-2 focus:ring-[#8a7390]/15" />
          </div>
          <button onClick={fetchRange} disabled={loading} className="px-6 py-2.5 bg-stone-900 hover:bg-stone-800 text-white font-medium tracking-wide rounded-lg transition-colors active:scale-[0.99] disabled:opacity-50 whitespace-nowrap">
            {loading ? "集計中…" : "集計する"}
          </button>
        </div>
      </div>

      {orders === null ? (
        <div className="text-center py-16 bg-white rounded-xl border border-stone-200 shadow-[0_1px_3px_rgba(40,33,26,0.05)] text-stone-400 text-sm">期間を選んで「集計する」を押してください。</div>
      ) : !agg || agg.dailyArr.length === 0 ? (
        <div className="text-center py-16 bg-white rounded-xl border border-stone-200 shadow-[0_1px_3px_rgba(40,33,26,0.05)] text-stone-400 text-sm">この期間のデータはありません。</div>
      ) : (
        <>
          {/* サマリー */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <Stat label="期間総売上" value={`¥${agg.totalSales.toLocaleString()}`} />
            <Stat label="総注文数" value={String(agg.validCount)} />
            <Stat label="営業日数" value={String(agg.days)} />
            <Stat label="1日平均売上" value={`¥${agg.avgPerDay.toLocaleString()}`} />
          </div>

          {/* 日次売上推移 */}
          <div className="bg-white rounded-xl border border-stone-200 shadow-[0_1px_3px_rgba(40,33,26,0.05)] p-5">
            <h3 className="text-[11px] font-semibold uppercase tracking-[0.12em] text-stone-400 mb-2">日次売上推移</h3>
            <div className="flex items-end gap-2 sm:gap-3 h-48 mt-6 pt-6 border-b border-stone-200 overflow-x-auto">
              {agg.dailyArr.map(([date, d]) => {
                const heightPercent = (d.sales / agg.maxDaily) * 100;
                const md = date.slice(5);
                return (
                  <div key={date} className="flex flex-col items-center flex-1 min-w-[34px] group relative h-full justify-end">
                    <div className="opacity-0 group-hover:opacity-100 absolute -top-7 bg-stone-900 text-white text-[10px] px-2 py-1 rounded transition-opacity whitespace-nowrap z-10 pointer-events-none tnum">
                      ¥{d.sales.toLocaleString()}
                    </div>
                    <div className="w-full bg-stone-200 group-hover:bg-[#8a7390] transition-colors rounded-t-[3px] min-h-[3px]" style={{ height: `${heightPercent}%` }}></div>
                    <span className="text-[10px] text-stone-400 mt-2 font-mono tnum whitespace-nowrap">{md}</span>
                  </div>
                );
              })}
            </div>
          </div>

          {/* 日次テーブル + CSV */}
          <div className="bg-white rounded-xl border border-stone-200 shadow-[0_1px_3px_rgba(40,33,26,0.05)] overflow-hidden">
            <div className="px-5 py-4 border-b border-stone-200 flex justify-between items-center">
              <h3 className="text-[11px] font-semibold uppercase tracking-[0.12em] text-stone-400">日次明細</h3>
              <button onClick={handleExportCSV} className="text-xs bg-stone-900 hover:bg-stone-800 text-white font-medium py-1.5 px-3 rounded-md transition-colors">
                CSV書き出し
              </button>
            </div>
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="text-[10px] uppercase tracking-wider text-stone-400 border-b border-stone-200">
                  <th className="px-5 py-2.5 font-semibold">営業日</th>
                  <th className="px-3 py-2.5 font-semibold text-right">注文数</th>
                  <th className="px-5 py-2.5 font-semibold text-right">売上</th>
                </tr>
              </thead>
              <tbody>
                {agg.dailyArr.map(([date, d]) => (
                  <tr key={date} className="border-b border-stone-100 last:border-0 hover:bg-stone-50/50">
                    <td className="px-5 py-2.5 font-mono font-medium text-stone-700 tnum">{date}</td>
                    <td className="px-3 py-2.5 text-right font-mono text-stone-500 tnum">{d.count}</td>
                    <td className="px-5 py-2.5 text-right font-mono font-semibold text-stone-900 tnum">¥{d.sales.toLocaleString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* 期間人気商品 */}
          <div className="bg-white rounded-xl border border-stone-200 shadow-[0_1px_3px_rgba(40,33,26,0.05)] p-5">
            <h3 className="text-[11px] font-semibold uppercase tracking-[0.12em] text-stone-400 mb-4">期間の人気商品 TOP10</h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-1">
              {agg.rankingArr.map(([name, count], index) => (
                <div key={name} className="flex justify-between items-center py-2 border-b border-stone-100">
                  <div className="flex items-center gap-2.5 min-w-0">
                    <span className={`w-5 text-center text-xs font-semibold tnum ${index < 3 ? "text-[#8a7390]" : "text-stone-300"}`}>{index + 1}</span>
                    <span className="text-sm text-stone-700 truncate">{name}</span>
                  </div>
                  <span className="text-sm font-mono font-semibold text-stone-900 tnum shrink-0">{count}</span>
                </div>
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
