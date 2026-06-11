"use client";

import { useState, useCallback, useMemo } from "react";
import { collection, query, where, getDocs } from "firebase/firestore";
import { db } from "../lib/firebase";
import { Order } from "../lib/types";
import { escapeCsv } from "../lib/utils";
import { useToast } from "../lib/toast";
import { InfoTip } from "../lib/info";

// ==========================================
// 📈 期間集計（PeriodView）
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

  return (
    <div className="space-y-6">
      {/* 期間選択 */}
      <div className="bg-white p-5 rounded-2xl border shadow-sm">
        <h3 className="font-bold text-neutral-700 text-sm mb-4 flex items-center gap-1.5">
          📈 期間を指定して集計
          <InfoTip text="開始日と終了日を選んで「集計する」を押すと、その期間の売上をまとめて表示します。複数日の合計や1日ごとの推移、人気商品が分かります。" align="left" />
        </h3>
        <div className="flex flex-col sm:flex-row sm:items-end gap-3">
          <div className="flex-1">
            <label className="block text-xs text-neutral-400 font-bold mb-1">開始日</label>
            <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="w-full border border-neutral-300 rounded px-2 py-2 text-neutral-800 bg-neutral-50 font-medium focus:outline-none focus:border-orange-500" />
          </div>
          <div className="flex-1">
            <label className="block text-xs text-neutral-400 font-bold mb-1">終了日</label>
            <input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="w-full border border-neutral-300 rounded px-2 py-2 text-neutral-800 bg-neutral-50 font-medium focus:outline-none focus:border-orange-500" />
          </div>
          <button onClick={fetchRange} disabled={loading} className="px-6 py-2.5 bg-stone-800 hover:bg-stone-700 text-white font-bold rounded-xl text-sm shadow-sm active:scale-95 disabled:opacity-50 whitespace-nowrap">
            {loading ? "集計中..." : "集計する"}
          </button>
        </div>
      </div>

      {orders === null ? (
        <div className="text-center py-16 bg-white rounded-2xl border text-neutral-400 text-sm shadow-sm">期間を選んで「集計する」を押してください。</div>
      ) : !agg || agg.dailyArr.length === 0 ? (
        <div className="text-center py-16 bg-white rounded-2xl border text-neutral-400 text-sm shadow-sm">この期間のデータはありません。</div>
      ) : (
        <>
          {/* サマリー */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            <div className="bg-white p-4 rounded-2xl border shadow-sm">
              <div className="text-xs text-neutral-400 font-bold mb-1">期間総売上</div>
              <div className="text-xl sm:text-2xl font-black font-mono text-neutral-800">¥{agg.totalSales.toLocaleString()}</div>
            </div>
            <div className="bg-white p-4 rounded-2xl border shadow-sm">
              <div className="text-xs text-neutral-400 font-bold mb-1">総注文数</div>
              <div className="text-xl sm:text-2xl font-black font-mono text-neutral-800">{agg.validCount}</div>
            </div>
            <div className="bg-white p-4 rounded-2xl border shadow-sm">
              <div className="text-xs text-neutral-400 font-bold mb-1">営業日数</div>
              <div className="text-xl sm:text-2xl font-black font-mono text-neutral-800">{agg.days}</div>
            </div>
            <div className="bg-white p-4 rounded-2xl border shadow-sm">
              <div className="text-xs text-neutral-400 font-bold mb-1">1日平均売上</div>
              <div className="text-xl sm:text-2xl font-black font-mono text-neutral-800">¥{agg.avgPerDay.toLocaleString()}</div>
            </div>
          </div>

          {/* 日次売上推移 */}
          <div className="bg-white p-5 rounded-2xl border shadow-sm">
            <h3 className="font-bold text-neutral-700 mb-4 text-sm border-b pb-2">📊 日次売上推移</h3>
            <div className="flex items-end gap-2 sm:gap-3 h-48 mt-6 pt-6 border-b border-neutral-200 overflow-x-auto">
              {agg.dailyArr.map(([date, d]) => {
                const heightPercent = (d.sales / agg.maxDaily) * 100;
                const md = date.slice(5);
                return (
                  <div key={date} className="flex flex-col items-center flex-1 min-w-[36px] group relative h-full justify-end">
                    <div className="opacity-0 group-hover:opacity-100 absolute -top-7 bg-neutral-800 text-white text-[10px] px-2 py-1 rounded transition-opacity whitespace-nowrap z-10 pointer-events-none">
                      ¥{d.sales.toLocaleString()}
                    </div>
                    <div className="w-full bg-orange-300 group-hover:bg-orange-500 transition-all duration-300 rounded-t-md min-h-[4px]" style={{ height: `${heightPercent}%` }}></div>
                    <span className="text-[10px] text-neutral-500 mt-2 font-mono whitespace-nowrap">{md}</span>
                  </div>
                );
              })}
            </div>
          </div>

          {/* 日次テーブル + CSV */}
          <div className="bg-white rounded-2xl border overflow-hidden shadow-sm">
            <div className="p-4 bg-neutral-50 border-b flex justify-between items-center">
              <h3 className="font-bold text-neutral-700 text-sm">🗓 日次明細</h3>
              <button onClick={handleExportCSV} className="text-xs bg-stone-800 hover:bg-stone-700 text-white font-bold py-1.5 px-3 rounded transition-colors shadow-sm">
                📥 CSVでエクスポート
              </button>
            </div>
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="bg-neutral-50 text-neutral-400 text-xs font-bold border-b">
                  <th className="p-3">営業日</th>
                  <th className="p-3 text-right">注文数</th>
                  <th className="p-3 text-right">売上</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-neutral-100">
                {agg.dailyArr.map(([date, d]) => (
                  <tr key={date} className="hover:bg-neutral-50/50">
                    <td className="p-3 font-mono font-bold text-neutral-700">{date}</td>
                    <td className="p-3 text-right font-mono text-neutral-600">{d.count}</td>
                    <td className="p-3 text-right font-mono font-black text-neutral-800">¥{d.sales.toLocaleString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* 期間人気商品 */}
          <div className="bg-white p-5 rounded-2xl border shadow-sm">
            <h3 className="font-bold text-neutral-700 mb-4 text-sm border-b pb-2">🏆 期間の人気商品 TOP10</h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-8 gap-y-3 text-sm">
              {agg.rankingArr.map(([name, count], index) => (
                <div key={name} className="flex justify-between items-center py-2 bg-white px-3 rounded-lg border shadow-sm">
                  <div className="flex items-center gap-2">
                    <span className={`w-5 h-5 flex items-center justify-center rounded-full text-xs font-black text-white ${index === 0 ? "bg-amber-400" : index === 1 ? "bg-stone-400" : index === 2 ? "bg-amber-600" : "bg-neutral-300"}`}>
                      {index + 1}
                    </span>
                    <span className="text-neutral-700 font-bold">{name}</span>
                  </div>
                  <span className="font-black font-mono text-neutral-800 bg-neutral-100 px-2 py-0.5 rounded">{count} 個</span>
                </div>
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
