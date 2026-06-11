"use client";

import { useState, useEffect, useMemo } from "react";
import { doc, updateDoc } from "firebase/firestore";
import { db } from "../lib/firebase";
import { Order, MenuItem } from "../lib/types";
import { groupOrderItems, escapeCsv } from "../lib/utils";
import { useToast } from "../lib/toast";
import { InfoTip } from "../lib/info";
import OrderEditModal from "./order-edit-modal";

// ==========================================
// 📊 売上明細（DashboardView）
// 軽量化: orders の走査を 1 パスに統合し、集計は単一の useMemo に集約
// ==========================================
export default function DashboardView({
  orders,
  selectedDate,
  menuItems,
}: {
  orders: Order[];
  selectedDate: string;
  menuItems: MenuItem[];
}) {
  const { showError } = useToast();
  const [selectedHourTab, setSelectedHourTab] = useState<string>("");
  const [isCancelling, setIsCancelling] = useState<string | null>(null);
  const [confirmCancelId, setConfirmCancelId] = useState<string | null>(null);
  const [editingOrder, setEditingOrder] = useState<Order | null>(null);

  useEffect(() => {
    setSelectedHourTab("");
    setConfirmCancelId(null);
  }, [selectedDate]);

  // createdAt を持つ注文だけを 1 度だけパースしてキャッシュ
  const parsedOrders = useMemo(() => {
    return orders
      .filter((o) => o.createdAt)
      .map((o) => {
        const dateObj = new Date(o.createdAt!.seconds * 1000);
        return {
          ...o,
          hour: dateObj.getHours(),
          timeStr: dateObj.toLocaleTimeString("ja-JP", { hour: "2-digit", minute: "2-digit" }),
          hourStr: `${dateObj.getHours()}時`,
        };
      });
  }, [orders]);

  // 🔴 単一パスで全集計を算出（売上・時間帯・時間帯別内訳・ランキング）
  const stats = useMemo(() => {
    let totalSales = 0;
    let validCount = 0;
    const hourCounts: Record<number, number> = {};
    const hourlyDetails: Record<string, Record<string, number>> = {};
    const ranking: Record<string, number> = {};
    let minHour = 24;
    let maxHour = -1;

    for (const o of parsedOrders) {
      if (o.status === "cancelled") continue;
      validCount += 1;
      totalSales += o.totalPrice;
      hourCounts[o.hour] = (hourCounts[o.hour] || 0) + 1;
      if (o.hour < minHour) minHour = o.hour;
      if (o.hour > maxHour) maxHour = o.hour;

      const hourKey = `${o.hour}:00台`;
      if (!hourlyDetails[hourKey]) hourlyDetails[hourKey] = {};
      o.items?.forEach((item) => {
        const label = item.temperature ? `${item.name} (${item.temperature})` : item.name;
        hourlyDetails[hourKey][label] = (hourlyDetails[hourKey][label] || 0) + item.quantity;
        ranking[label] = (ranking[label] || 0) + item.quantity;
      });
    }

    // 棒グラフ用の連続した時間帯配列
    const hourlyData: [string, number][] = [];
    if (maxHour >= 0) {
      for (let i = Math.max(0, minHour - 1); i <= Math.min(23, maxHour + 1); i++) {
        hourlyData.push([`${i}:00`, hourCounts[i] || 0]);
      }
    }
    const maxHourlyCount = Math.max(1, ...hourlyData.map((d) => d[1]));
    const activeHours = Object.keys(hourlyDetails).sort((a, b) => parseInt(a) - parseInt(b));
    const rankingArr = Object.entries(ranking).sort((a, b) => b[1] - a[1]);

    return { totalSales, validCount, hourlyData, maxHourlyCount, hourlyDetails, activeHours, rankingArr };
  }, [parsedOrders]);

  const groupedOrdersMap = useMemo(
    () => Object.fromEntries(parsedOrders.map((o) => [o.id, groupOrderItems(o.items)])),
    [parsedOrders]
  );

  // 表示は新しい注文が上（逆順）
  const reversedOrders = useMemo(() => [...parsedOrders].reverse(), [parsedOrders]);

  useEffect(() => {
    if (stats.activeHours.length > 0 && !selectedHourTab) setSelectedHourTab(stats.activeHours[0]);
  }, [stats.activeHours, selectedHourTab]);

  const handleCancelOrder = async (id: string) => {
    if (isCancelling) return;
    setIsCancelling(id);
    try {
      await updateDoc(doc(db, "orders", id), { status: "cancelled" });
      setConfirmCancelId(null);
    } catch (e) {
      console.error(e);
      showError("注文の取消に失敗しました。");
    } finally {
      setIsCancelling(null);
    }
  };

  const handleExportCSV = () => {
    if (parsedOrders.length === 0) {
      showError("エクスポートするデータがありません。");
      return;
    }
    const headers = ["注文日時", "時間帯(時)", "整理番号", "カテゴリ", "商品名", "温度", "数量", "単価", "小計", "ステータス"];
    const rows: string[] = [];
    parsedOrders.forEach((order) => {
      const ticket = order.ticketNumber || "";
      const status = order.status === "completed" ? "提供済" : order.status === "cancelled" ? "取消済" : "未対応";
      order.items.forEach((item) => {
        rows.push(
          [
            escapeCsv(order.timeStr),
            escapeCsv(order.hourStr),
            escapeCsv(ticket),
            escapeCsv(item.category || ""),
            escapeCsv(item.name),
            escapeCsv(item.temperature || ""),
            item.quantity,
            item.price,
            item.price * item.quantity,
            escapeCsv(status),
          ].join(",")
        );
      });
    });
    const csvContent = "﻿" + [headers.join(","), ...rows].join("\n");
    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    const now = new Date();
    const timeSuffix = `${String(now.getHours()).padStart(2, "0")}-${String(now.getMinutes()).padStart(2, "0")}`;
    link.setAttribute("download", `売上明細_${selectedDate}_${timeSuffix}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  const hasData = stats.validCount > 0;

  return (
    <div className="space-y-6">
      {/* サマリー */}
      <div className="grid grid-cols-2 gap-4">
        <div className="bg-white p-5 rounded-2xl border shadow-sm">
          <div className="text-xs text-neutral-400 font-bold mb-1 flex items-center gap-1">
            本日の総売上 <span className="text-[10px] font-normal">※取消除く</span>
            <InfoTip text="選択中の営業日の売上合計です。取消した注文は含みません。" align="left" />
          </div>
          <div className="text-2xl sm:text-3xl font-black font-mono text-neutral-800">¥{stats.totalSales.toLocaleString()}</div>
        </div>
        <div className="bg-white p-5 rounded-2xl border shadow-sm">
          <div className="text-xs text-neutral-400 font-bold mb-1 flex items-center gap-1">
            有効注文数
            <InfoTip text="取消を除いた注文の件数です。1回の会計＝1件と数えます。" align="left" />
          </div>
          <div className="text-2xl sm:text-3xl font-black font-mono text-neutral-800">
            {stats.validCount} <span className="text-lg text-neutral-500 font-sans">件</span>
          </div>
        </div>
      </div>

      {/* 時間帯別の注文数 */}
      <div className="bg-white p-5 rounded-2xl border shadow-sm">
        <h3 className="font-bold text-neutral-700 mb-4 text-sm border-b pb-2 flex items-center gap-1.5">
          ⏰ 時間帯別の注文数（混雑状況）
          <InfoTip text="1時間ごとの注文件数を棒グラフにしたものです。棒にカーソルを合わせると件数が出ます。混む時間帯の把握に使えます。" align="left" />
        </h3>
        {!hasData ? (
          <p className="text-neutral-400 text-sm text-center py-6">データがありません</p>
        ) : (
          <div className="flex items-end gap-1 sm:gap-2 h-40 mt-6 pt-6 border-b border-neutral-200">
            {stats.hourlyData.map(([time, count]) => {
              const heightPercent = (count / stats.maxHourlyCount) * 100;
              return (
                <div key={time} className="flex flex-col items-center flex-1 group relative h-full justify-end">
                  <div className="opacity-0 group-hover:opacity-100 absolute -top-7 bg-neutral-800 text-white text-[10px] px-2 py-1 rounded transition-opacity whitespace-nowrap z-10 pointer-events-none">
                    {count}件
                  </div>
                  <div className="w-full bg-stone-200 group-hover:bg-orange-400 transition-all duration-300 rounded-t-sm min-h-[4px]" style={{ height: `${heightPercent}%` }}></div>
                  <span className="text-[10px] text-neutral-500 mt-2 font-mono whitespace-nowrap">{time}</span>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* 時間帯別の売れ行き */}
      <div className="bg-white p-5 rounded-2xl border shadow-sm">
        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3 mb-4 border-b pb-2">
          <h3 className="font-bold text-neutral-700 text-sm flex items-center gap-1.5">
            🕒 時間帯別の売れ行き詳細
            <InfoTip text="選んだ時間帯に、どの商品が何個売れたかの内訳です。右のメニューで時間帯を切り替えられます。" align="left" />
          </h3>
          {stats.activeHours.length > 0 && (
            <div className="flex items-center gap-2 text-sm">
              <span className="text-neutral-500 font-medium">時間帯を選択:</span>
              <select
                value={selectedHourTab}
                onChange={(e) => setSelectedHourTab(e.target.value)}
                className="border rounded p-1 text-neutral-800 font-bold bg-neutral-50 focus:outline-none focus:border-orange-500"
              >
                {stats.activeHours.map((h) => (
                  <option key={h} value={h}>
                    {h}
                  </option>
                ))}
              </select>
            </div>
          )}
        </div>

        {!hasData ? (
          <p className="text-neutral-400 text-sm text-center py-6">データがありません</p>
        ) : !selectedHourTab || !stats.hourlyDetails[selectedHourTab] ? (
          <p className="text-neutral-400 text-sm text-center py-6">販売データがありません</p>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-8 gap-y-2 text-sm bg-neutral-50 p-4 rounded-xl border">
            {Object.entries(stats.hourlyDetails[selectedHourTab])
              .sort((a, b) => b[1] - a[1])
              .map(([itemName, qty]) => (
                <div key={itemName} className="flex justify-between items-center py-2 border-b border-neutral-200 last:border-0 bg-white px-3 rounded-lg shadow-sm">
                  <span className="text-neutral-700 font-bold">{itemName}</span>
                  <span className="font-black font-mono text-orange-600 bg-orange-50 px-2.5 py-0.5 rounded text-xs">{qty} 個</span>
                </div>
              ))}
          </div>
        )}
      </div>

      {/* 人気商品ランキング */}
      <div className="bg-white p-5 rounded-2xl border shadow-sm">
        <h3 className="font-bold text-neutral-700 mb-4 text-sm border-b pb-2 flex items-center gap-1.5">
          🏆 人気商品ランキング
          <InfoTip text="その日に売れた数が多い順の商品ランキングです。HOT/ICEは別々に集計します。" align="left" />
        </h3>
        {stats.rankingArr.length === 0 ? (
          <p className="text-neutral-400 text-sm text-center py-6">データがありません</p>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-8 gap-y-3 text-sm">
            {stats.rankingArr.map(([name, count], index) => (
              <div key={name} className="flex justify-between items-center py-2 border-b border-neutral-50 bg-white px-3 rounded-lg border shadow-sm">
                <div className="flex items-center gap-2">
                  <span
                    className={`w-5 h-5 flex items-center justify-center rounded-full text-xs font-black text-white ${
                      index === 0 ? "bg-amber-400" : index === 1 ? "bg-stone-400" : index === 2 ? "bg-amber-600" : "bg-neutral-300"
                    }`}
                  >
                    {index + 1}
                  </span>
                  <span className="text-neutral-700 font-bold">{name}</span>
                </div>
                <span className="font-black font-mono text-neutral-800 bg-neutral-100 px-2 py-0.5 rounded">{count} 個</span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* 取引明細 */}
      <div className="bg-white rounded-2xl border overflow-hidden shadow-sm">
        <div className="p-4 bg-neutral-50 border-b flex justify-between items-center">
          <h3 className="font-bold text-neutral-700 text-sm flex items-center gap-1.5">
            📑 取引明細一覧
            <InfoTip text="その日の全注文の一覧です。「編集」で内容を直したり、「取消」で無効にできます。取消しても記録は残ります。" align="left" />
          </h3>
          <div className="flex items-center gap-1.5">
            <button onClick={handleExportCSV} className="text-xs bg-stone-800 hover:bg-stone-700 text-white font-bold py-1.5 px-3 rounded flex items-center transition-colors shadow-sm">
              📥 CSVでエクスポート
            </button>
            <InfoTip text="表計算ソフト（Excelなど）で開けるCSVファイルとして、その日の明細を書き出します。会計報告や記録の保存に便利です。" align="right" />
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm border-collapse">
            <thead>
              <tr className="bg-neutral-50 text-neutral-400 text-xs font-bold border-b">
                <th className="p-3 whitespace-nowrap">時間/整理券</th>
                <th className="p-3">注文内容</th>
                <th className="p-3 whitespace-nowrap">状態</th>
                <th className="p-3 text-right whitespace-nowrap">金額</th>
                <th className="p-3 text-center whitespace-nowrap">操作</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-neutral-100">
              {parsedOrders.length === 0 ? (
                <tr>
                  <td colSpan={5} className="p-8 text-center text-neutral-400 text-sm">
                    取引履歴がありません
                  </td>
                </tr>
              ) : (
                reversedOrders.map((order) => {
                  const groupedItems = groupedOrdersMap[order.id] || {};
                  const isCancelled = order.status === "cancelled";
                  return (
                    <tr key={order.id} className={`hover:bg-neutral-50/50 transition-colors ${isCancelled ? "opacity-50 bg-neutral-50" : ""}`}>
                      <td className="p-3 align-top pt-4">
                        <div className={`font-mono text-xs font-medium ${isCancelled ? "text-neutral-400 line-through" : "text-neutral-500"}`}>{order.timeStr}</div>
                        {order.ticketNumber && (
                          <div className="mt-1 inline-block bg-amber-100 text-amber-700 px-1.5 py-0.5 rounded text-[10px] font-bold border border-amber-200">🎫 {order.ticketNumber}</div>
                        )}
                      </td>
                      <td className="p-3">
                        <div className={`space-y-1 ${isCancelled ? "line-through grayscale" : ""}`}>
                          {Object.entries(groupedItems).map(([name, group], i) => (
                            <div key={i} className="text-xs font-bold text-neutral-700">
                              {name} <span className="text-orange-500 font-mono ml-1">計{group.total}</span>
                              {group.subItems.length > 0 && (
                                <span className="text-neutral-400 font-normal ml-1">({group.subItems.map((s) => `${s.temperature}x${s.quantity}`).join(", ")})</span>
                              )}
                            </div>
                          ))}
                        </div>
                      </td>
                      <td className="p-3 align-top pt-4">
                        {isCancelled ? (
                          <span className="text-[10px] px-2 py-1 rounded font-black bg-neutral-200 text-neutral-500">取消済</span>
                        ) : (
                          <span className={`text-[10px] px-2 py-1 rounded font-black ${order.status === "completed" ? "bg-emerald-100 text-emerald-700" : "bg-amber-100 text-amber-700"}`}>
                            {order.status === "completed" ? "提供済" : "未対応"}
                          </span>
                        )}
                      </td>
                      <td className={`p-3 text-right font-black font-mono align-top pt-4 ${isCancelled ? "text-neutral-400 line-through" : "text-neutral-700"}`}>
                        ¥{order.totalPrice.toLocaleString()}
                      </td>
                      <td className="p-3 text-center align-top pt-3">
                        {!isCancelled &&
                          (confirmCancelId === order.id ? (
                            <div className="flex flex-col sm:flex-row items-center justify-center gap-1 bg-red-50 p-1 rounded border border-red-200">
                              <span className="text-[10px] text-red-700 font-bold block mb-1 sm:mb-0">本当に取消？</span>
                              <div className="flex gap-1">
                                <button onClick={() => handleCancelOrder(order.id)} disabled={isCancelling === order.id} className="text-[10px] bg-red-600 text-white px-2 py-0.5 rounded font-bold hover:bg-red-700 disabled:opacity-50">
                                  はい
                                </button>
                                <button onClick={() => setConfirmCancelId(null)} disabled={isCancelling === order.id} className="text-[10px] bg-neutral-200 text-neutral-700 px-2 py-0.5 rounded font-bold hover:bg-neutral-300">
                                  戻る
                                </button>
                              </div>
                            </div>
                          ) : (
                            <div className="flex items-center justify-center gap-1.5">
                              <button onClick={() => setEditingOrder(order)} className="text-xs text-stone-600 hover:bg-stone-100 border border-neutral-300 px-2 py-1 rounded font-bold transition-colors">
                                編集
                              </button>
                              <button onClick={() => setConfirmCancelId(order.id)} className="text-xs text-red-500 hover:bg-red-50 border border-red-200 px-2 py-1 rounded font-bold transition-colors">
                                取消
                              </button>
                            </div>
                          ))}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {editingOrder && <OrderEditModal order={editingOrder} menuItems={menuItems} onClose={() => setEditingOrder(null)} />}
    </div>
  );
}
