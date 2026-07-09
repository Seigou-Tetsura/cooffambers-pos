"use client";

import { useState, useEffect, useMemo } from "react";
import { Order, MenuItem, CatDef } from "../lib/types";
import { cancelOrderWithRestock } from "../lib/menu";
import { groupOrderItems, escapeCsv, computeCompletion, formatElapsed } from "../lib/utils";
import { useToast } from "../lib/toast";
import { InfoTip } from "../lib/info";
import OrderEditModal from "./order-edit-modal";

// ==========================================
// 売上明細（DashboardView）
// 軽量化: orders の走査を 1 パスに統合し、集計は単一の useMemo に集約
// ==========================================
export default function DashboardView({
  orders,
  selectedDate,
  menuItems,
  categories,
}: {
  orders: Order[];
  selectedDate: string;
  menuItems: MenuItem[];
  categories: CatDef[];
}) {
  const { showError, showToast } = useToast();
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

  // 単一パスで全集計を算出（売上・時間帯・時間帯別内訳・ランキング）
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

  const completion = useMemo(() => computeCompletion(orders), [orders]);

  const groupedOrdersMap = useMemo(
    () => Object.fromEntries(parsedOrders.map((o) => [o.id, groupOrderItems(o.items)])),
    [parsedOrders]
  );

  const reversedOrders = useMemo(() => [...parsedOrders].reverse(), [parsedOrders]);

  useEffect(() => {
    if (stats.activeHours.length > 0 && !selectedHourTab) setSelectedHourTab(stats.activeHours[0]);
  }, [stats.activeHours, selectedHourTab]);

  const handleCancelOrder = async (id: string) => {
    if (isCancelling) return;
    setIsCancelling(id);
    try {
      // 取消と同時に、在庫管理中の商品の在庫をそのオーダー分だけ足し戻す
      const restockedQty = await cancelOrderWithRestock(id);
      setConfirmCancelId(null);
      if (restockedQty > 0) showToast(`注文を取消し、在庫を${restockedQty}点戻しました`);
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
    <div className="space-y-5">
      {/* サマリー */}
      <div className="grid grid-cols-2 gap-4">
        <div className="bg-white rounded-xl border border-stone-200 shadow-[0_1px_3px_rgba(40,33,26,0.05)] p-5">
          <div className="text-[10px] font-semibold uppercase tracking-[0.12em] text-stone-400 mb-2 flex items-center gap-1">
            総売上
            <span className="normal-case tracking-normal text-stone-300">取消除く</span>
            <InfoTip text="選択中の営業日の売上合計です。取消した注文は含みません。" align="left" />
          </div>
          <div className="text-3xl font-semibold tnum text-stone-900">¥{stats.totalSales.toLocaleString()}</div>
        </div>
        <div className="bg-white rounded-xl border border-stone-200 shadow-[0_1px_3px_rgba(40,33,26,0.05)] p-5">
          <div className="text-[10px] font-semibold uppercase tracking-[0.12em] text-stone-400 mb-2 flex items-center gap-1">
            有効注文数
            <InfoTip text="取消を除いた注文の件数です。1回の会計＝1件と数えます。" align="left" />
          </div>
          <div className="text-3xl font-semibold tnum text-stone-900">
            {stats.validCount}
            <span className="text-base text-stone-400 font-normal ml-1">件</span>
          </div>
        </div>
      </div>

      {/* 平均オーダー完了時間 */}
      <div className="bg-white rounded-xl border border-stone-200 shadow-[0_1px_3px_rgba(40,33,26,0.05)] p-5">
        <h3 className="text-[11px] font-semibold uppercase tracking-[0.12em] text-stone-400 mb-2 flex items-center gap-1.5">
          平均オーダー完了時間
          <InfoTip text="受注から提供完了までの平均時間です。1日平均と時間帯別を表示します。完了済みで受注・提供の両時刻が記録された注文のみ対象です。" align="left" />
        </h3>
        {completion.avgSec === null ? (
          <p className="text-stone-400 text-sm text-center py-8">完了データがありません</p>
        ) : (
          <>
            <div className="flex items-baseline gap-2">
              <span className="text-3xl font-semibold tnum text-stone-900">{formatElapsed(completion.avgSec)}</span>
              <span className="text-xs text-stone-400">1日平均 ・ 完了 {completion.count} 件</span>
            </div>
            <div className="mt-4 pt-3 border-t border-stone-100">
              <div className="text-[10px] font-semibold uppercase tracking-[0.12em] text-stone-400 mb-2">時間帯別の平均</div>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-x-6 gap-y-0.5">
                {Object.keys(completion.byHourAvg)
                  .map(Number)
                  .sort((a, b) => a - b)
                  .map((h) => (
                    <div key={h} className="flex justify-between items-center py-1.5 border-b border-stone-100">
                      <span className="text-sm text-stone-500 font-mono tnum">{h}:00</span>
                      <span className="text-sm font-semibold text-stone-800 tnum">{formatElapsed(completion.byHourAvg[h])}</span>
                    </div>
                  ))}
              </div>
            </div>
          </>
        )}
      </div>

      {/* 時間帯別の注文数 */}
      <div className="bg-white rounded-xl border border-stone-200 shadow-[0_1px_3px_rgba(40,33,26,0.05)] p-5">
        <h3 className="text-[11px] font-semibold uppercase tracking-[0.12em] text-stone-400 mb-2 flex items-center gap-1.5">
          時間帯別の注文数
          <InfoTip text="1時間ごとの注文件数を棒グラフにしたものです。棒にカーソルを合わせると件数が出ます。混む時間帯の把握に使えます。" align="left" />
        </h3>
        {!hasData ? (
          <p className="text-stone-400 text-sm text-center py-8">データがありません</p>
        ) : (
          <div className="mt-4">
            <div className="flex gap-2">
              <div className="flex flex-col justify-between h-44 text-[9px] text-stone-300 font-mono tnum text-right shrink-0 w-6 leading-none">
                <span>{stats.maxHourlyCount}</span>
                <span>{Math.round(stats.maxHourlyCount / 2)}</span>
                <span>0</span>
              </div>
              <div className="relative flex-1 h-44">
                <div className="absolute inset-0 flex flex-col justify-between pointer-events-none">
                  <div className="border-t border-stone-100"></div>
                  <div className="border-t border-stone-100"></div>
                  <div className="border-t border-stone-200"></div>
                </div>
                <div className="relative h-full flex items-end gap-1.5 sm:gap-2">
                  {stats.hourlyData.map(([time, count]) => {
                    const heightPercent = (count / stats.maxHourlyCount) * 100;
                    return (
                      <div key={time} className="flex flex-col items-center flex-1 h-full justify-end group">
                        <span className="text-[9px] text-stone-400 font-mono tnum mb-0.5 h-3">{count > 0 ? count : ""}</span>
                        <div
                          className="w-full bg-stone-200 group-hover:bg-[#6b7e9d] transition-colors rounded-t-[3px] min-h-[2px]"
                          style={{ height: `${heightPercent}%` }}
                          title={`${time} ・ ${count}件`}
                        ></div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
            <div className="flex gap-2 mt-1">
              <div className="w-6 shrink-0"></div>
              <div className="flex-1 flex gap-1.5 sm:gap-2">
                {stats.hourlyData.map(([time]) => (
                  <span key={time} className="flex-1 text-center text-[10px] text-stone-400 font-mono tnum">{time}</span>
                ))}
              </div>
            </div>
          </div>
        )}
      </div>

      {/* 時間帯別の売れ行き */}
      <div className="bg-white rounded-xl border border-stone-200 shadow-[0_1px_3px_rgba(40,33,26,0.05)] p-5">
        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3 mb-4">
          <h3 className="text-[11px] font-semibold uppercase tracking-[0.12em] text-stone-400 flex items-center gap-1.5">
            時間帯別の売れ行き
            <InfoTip text="選んだ時間帯に、どの商品が何個売れたかの内訳です。右のメニューで時間帯を切り替えられます。" align="left" />
          </h3>
          {stats.activeHours.length > 0 && (
            <select
              value={selectedHourTab}
              onChange={(e) => setSelectedHourTab(e.target.value)}
              className="border border-stone-300 rounded-md px-2 py-1 text-sm text-stone-700 font-medium bg-white focus:outline-none focus:border-[#6b7e9d]"
            >
              {stats.activeHours.map((h) => (
                <option key={h} value={h}>
                  {h}
                </option>
              ))}
            </select>
          )}
        </div>

        {!hasData ? (
          <p className="text-stone-400 text-sm text-center py-8">データがありません</p>
        ) : !selectedHourTab || !stats.hourlyDetails[selectedHourTab] ? (
          <p className="text-stone-400 text-sm text-center py-8">販売データがありません</p>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-1">
            {Object.entries(stats.hourlyDetails[selectedHourTab])
              .sort((a, b) => b[1] - a[1])
              .map(([itemName, qty]) => (
                <div key={itemName} className="flex justify-between items-center py-2 border-b border-stone-100">
                  <span className="text-sm text-stone-700">{itemName}</span>
                  <span className="text-sm font-mono font-semibold text-stone-900 tnum">{qty}</span>
                </div>
              ))}
          </div>
        )}
      </div>

      {/* 人気商品ランキング */}
      <div className="bg-white rounded-xl border border-stone-200 shadow-[0_1px_3px_rgba(40,33,26,0.05)] p-5">
        <h3 className="text-[11px] font-semibold uppercase tracking-[0.12em] text-stone-400 mb-4 flex items-center gap-1.5">
          人気商品ランキング
          <InfoTip text="その日に売れた数が多い順の商品ランキングです。HOT / ICEは別々に集計します。" align="left" />
        </h3>
        {stats.rankingArr.length === 0 ? (
          <p className="text-stone-400 text-sm text-center py-8">データがありません</p>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-1">
            {stats.rankingArr.map(([name, count], index) => (
              <div key={name} className="flex justify-between items-center py-2 border-b border-stone-100">
                <div className="flex items-center gap-2.5 min-w-0">
                  <span className={`w-5 text-center text-xs font-semibold tnum ${index < 3 ? "text-[#6b7e9d]" : "text-stone-300"}`}>{index + 1}</span>
                  <span className="text-sm text-stone-700 truncate">{name}</span>
                </div>
                <span className="text-sm font-mono font-semibold text-stone-900 tnum shrink-0">{count}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* 取引明細 */}
      <div className="bg-white rounded-xl border border-stone-200 shadow-[0_1px_3px_rgba(40,33,26,0.05)] overflow-hidden">
        <div className="px-5 py-4 border-b border-stone-200 flex justify-between items-center">
          <h3 className="text-[11px] font-semibold uppercase tracking-[0.12em] text-stone-400 flex items-center gap-1.5">
            取引明細
            <InfoTip text="その日の全注文の一覧です。「編集」で内容を直したり、「取消」で無効にできます。取消しても記録は残ります。" align="left" />
          </h3>
          <div className="flex items-center gap-1.5">
            <button onClick={handleExportCSV} className="text-xs bg-stone-900 hover:bg-stone-800 text-white font-medium py-1.5 px-3 rounded-md transition-colors">
              CSV書き出し
            </button>
            <InfoTip text="表計算ソフト（Excelなど）で開けるCSVファイルとして、その日の明細を書き出します。会計報告や記録の保存に便利です。" align="right" />
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="text-[10px] uppercase tracking-wider text-stone-400 border-b border-stone-200">
                <th className="px-5 py-2.5 font-semibold whitespace-nowrap">時間 / 整理番号</th>
                <th className="px-3 py-2.5 font-semibold">注文内容</th>
                <th className="px-3 py-2.5 font-semibold whitespace-nowrap">状態</th>
                <th className="px-3 py-2.5 font-semibold text-right whitespace-nowrap">金額</th>
                <th className="px-5 py-2.5 font-semibold text-center whitespace-nowrap">操作</th>
              </tr>
            </thead>
            <tbody>
              {parsedOrders.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-5 py-10 text-center text-stone-400 text-sm">
                    取引履歴がありません
                  </td>
                </tr>
              ) : (
                reversedOrders.map((order) => {
                  const groupedItems = groupedOrdersMap[order.id] || {};
                  const isCancelled = order.status === "cancelled";
                  return (
                    <tr key={order.id} className={`border-b border-stone-100 last:border-0 hover:bg-stone-50/50 transition-colors ${isCancelled ? "opacity-50" : ""}`}>
                      <td className="px-5 py-3 align-top">
                        <div className={`font-mono text-xs tnum ${isCancelled ? "text-stone-400 line-through" : "text-stone-500"}`}>{order.timeStr}</div>
                        {order.ticketNumber && (
                          <div className="mt-1 inline-block bg-stone-100 text-stone-600 px-1.5 py-0.5 rounded text-[10px] font-semibold tnum">No. {order.ticketNumber}</div>
                        )}
                      </td>
                      <td className="px-3 py-3">
                        <div className={`space-y-0.5 ${isCancelled ? "line-through" : ""}`}>
                          {Object.entries(groupedItems).map(([name, group], i) => (
                            <div key={i} className="text-xs text-stone-700">
                              <span className="font-medium">{name}</span> <span className="text-stone-400 font-mono tnum">×{group.total}</span>
                              {group.subItems.length > 0 && (
                                <span className="text-stone-400 ml-1">（{group.subItems.map((s) => `${s.temperature === "Hot" ? "HOT" : "ICE"}×${s.quantity}`).join(", ")}）</span>
                              )}
                            </div>
                          ))}
                        </div>
                      </td>
                      <td className="px-3 py-3 align-top">
                        {isCancelled ? (
                          <span className="text-[10px] px-2 py-0.5 rounded-full font-semibold bg-stone-100 text-stone-400">取消済</span>
                        ) : (
                          <span className={`text-[10px] px-2 py-0.5 rounded-full font-semibold ${order.status === "completed" ? "bg-emerald-50 text-emerald-600" : "bg-amber-50 text-amber-600"}`}>
                            {order.status === "completed" ? "提供済" : "未対応"}
                          </span>
                        )}
                      </td>
                      <td className={`px-3 py-3 text-right font-mono font-semibold tnum align-top ${isCancelled ? "text-stone-400 line-through" : "text-stone-800"}`}>
                        ¥{order.totalPrice.toLocaleString()}
                      </td>
                      <td className="px-5 py-3 text-center align-top">
                        {!isCancelled &&
                          (confirmCancelId === order.id ? (
                            <div className="inline-flex items-center gap-1 bg-red-50 px-1.5 py-1 rounded-md border border-red-200">
                              <span className="text-[10px] text-red-600 font-medium">取消？</span>
                              <button onClick={() => handleCancelOrder(order.id)} disabled={isCancelling === order.id} className="text-[10px] bg-red-600 text-white px-2 py-0.5 rounded font-medium hover:bg-red-700 disabled:opacity-50">
                                はい
                              </button>
                              <button onClick={() => setConfirmCancelId(null)} disabled={isCancelling === order.id} className="text-[10px] bg-white text-stone-500 border border-stone-200 px-2 py-0.5 rounded font-medium hover:bg-stone-50">
                                戻る
                              </button>
                            </div>
                          ) : (
                            <div className="inline-flex items-center gap-1.5">
                              <button onClick={() => setEditingOrder(order)} className="text-xs text-stone-500 hover:text-stone-800 border border-stone-300 px-2.5 py-1 rounded-md transition-colors">
                                編集
                              </button>
                              <button onClick={() => setConfirmCancelId(order.id)} className="text-xs text-stone-500 hover:text-red-600 hover:border-red-200 border border-stone-300 px-2.5 py-1 rounded-md transition-colors">
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

      {editingOrder && <OrderEditModal order={editingOrder} menuItems={menuItems} categories={categories} onClose={() => setEditingOrder(null)} />}
    </div>
  );
}
