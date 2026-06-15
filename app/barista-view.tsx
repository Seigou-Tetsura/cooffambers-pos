"use client";

import { useState, useMemo, useEffect } from "react";
import { doc, updateDoc, serverTimestamp } from "firebase/firestore";
import { db } from "../lib/firebase";
import { Order, CartItem, MenuItem } from "../lib/types";
import { groupOrderItems, formatElapsed, elapsedUrgency } from "../lib/utils";
import { mutateMenu } from "../lib/menu";
import { useToast } from "../lib/toast";
import { InfoTip } from "../lib/info";

// ==========================================
// バリスタ画面（BaristaView）
// 提供待ちオーダーの製造・提供管理。経過時間・品切れ切替・商品別チェック・完了一覧に対応
// ==========================================
const CheckIcon = ({ className = "" }: { className?: string }) => (
  <svg viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" className={className}>
    <path d="M2.5 7.5l3 3 6-7" />
  </svg>
);

export default function BaristaView({
  orders,
  isOrdersLoading,
  menuItems,
  selectedDate,
}: {
  orders: Order[];
  isOrdersLoading: boolean;
  menuItems: MenuItem[];
  selectedDate: string;
}) {
  const { showError, showUndo } = useToast();
  const [completingId, setCompletingId] = useState<string | null>(null);
  const [showSoldOutPanel, setShowSoldOutPanel] = useState(false);
  const [showCompleted, setShowCompleted] = useState(false);
  const [togglingId, setTogglingId] = useState<string | null>(null);

  // 経過時間をリアルタイム表示するための現在時刻（1秒ごとに更新 → 画面操作なしで動く）
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);

  const pendingOrders = useMemo(() => orders.filter((o) => o.status === "pending"), [orders]);

  // 完了した注文（新しく完了したものが上）
  const completedOrders = useMemo(() => {
    const ts = (o: Order) => (o.completedAt ? o.completedAt.seconds : o.createdAt ? o.createdAt.seconds : 0);
    return orders.filter((o) => o.status === "completed").sort((a, b) => ts(b) - ts(a));
  }, [orders]);

  // ---- Firestore 更新系 ----
  const completeOrder = async (id: string) => {
    await updateDoc(doc(db, "orders", id), { status: "completed", completedAt: serverTimestamp() });
  };
  const revertOrder = async (id: string) => {
    await updateDoc(doc(db, "orders", id), { status: "pending", completedAt: null });
  };

  // 提供完了 → 誤タップに備え「元に戻す」トーストを表示（直前の1件を即復帰）
  const handleComplete = async (id: string, ticket?: string | null) => {
    if (completingId) return;
    setCompletingId(id);
    try {
      await completeOrder(id);
      const label = ticket ? `整理番号 ${ticket}` : "オーダー";
      showUndo(`${label} を提供完了しました`, () => {
        revertOrder(id).catch((e) => {
          console.error(e);
          showError("元に戻せませんでした。");
        });
      });
    } catch (e) {
      console.error(e);
      showError("ステータスの更新に失敗しました。");
    } finally {
      setCompletingId(null);
    }
  };

  const handleRevert = async (id: string) => {
    try {
      await revertOrder(id);
    } catch (e) {
      console.error(e);
      showError("取消に失敗しました。");
    }
  };

  // 商品ごとの提供済みチェックを Firestore に保存
  const handleToggleItemServed = async (order: Order, itemId: string) => {
    const newItems: CartItem[] = order.items.map((it) => (it.id === itemId ? { ...it, served: !it.served } : it));
    try {
      await updateDoc(doc(db, "orders", order.id), { items: newItems });
    } catch (e) {
      console.error(e);
      showError("提供チェックの更新に失敗しました。");
    }
  };

  const handleToggleSoldOut = async (id: string, value: boolean) => {
    if (togglingId) return;
    setTogglingId(id);
    try {
      await mutateMenu(selectedDate, { type: "toggleSoldOut", id, value });
    } catch (e) {
      console.error(e);
      showError("品切れ設定の更新に失敗しました。");
    } finally {
      setTogglingId(null);
    }
  };

  // 製造タスク集計（まだ提供していない商品だけを集計）
  const overallSummary = useMemo(() => {
    const summary: Record<string, { total: number; details: Record<string, number> }> = {};
    pendingOrders.forEach((order) => {
      order.items?.forEach((item) => {
        if (item.served) return;
        if (!summary[item.name]) summary[item.name] = { total: 0, details: {} };
        summary[item.name].total += item.quantity;
        if (item.temperature) {
          summary[item.name].details[item.temperature] = (summary[item.name].details[item.temperature] || 0) + item.quantity;
        }
      });
    });
    return summary;
  }, [pendingOrders]);

  const totalPendingItems = useMemo(
    () => pendingOrders.reduce((sum, order) => sum + (order.items?.reduce((s, item) => s + (item.served ? 0 : item.quantity), 0) || 0), 0),
    [pendingOrders]
  );

  const soldOutCount = useMemo(() => menuItems.filter((m) => m.soldOut).length, [menuItems]);

  if (isOrdersLoading) return <div className="text-center py-24 text-stone-400 text-sm tracking-wide">オーダーを読み込み中…</div>;

  const urgencyStyles: Record<string, { card: string; badge: string }> = {
    normal: { card: "border-stone-200", badge: "bg-stone-100 text-stone-500" },
    warn: { card: "border-amber-300 ring-1 ring-amber-200/60", badge: "bg-amber-100 text-amber-700" },
    danger: { card: "border-red-300 ring-1 ring-red-200/60", badge: "bg-red-100 text-red-700" },
  };

  return (
    <div className="space-y-5">
      <div className="bg-white rounded-xl border border-stone-200 shadow-[0_1px_3px_rgba(40,33,26,0.05)] px-5 py-4 flex flex-wrap gap-3 justify-between items-center">
        <h2 className="text-[11px] font-semibold uppercase tracking-[0.12em] text-stone-400 flex items-center gap-1.5">
          提供待ち
          <span className="text-stone-800 normal-case tracking-normal text-base font-semibold tnum ml-0.5">{pendingOrders.length}</span>
          <span className="normal-case tracking-normal text-stone-400 font-normal">件</span>
          <InfoTip text="まだ提供していない注文の一覧です。古い注文ほど上に並びます。各注文の「提供完了」を押すと下の完了一覧に移動します。" align="left" />
        </h2>
        <button
          onClick={() => setShowSoldOutPanel((v) => !v)}
          className={`text-xs font-medium px-3 py-1.5 rounded-md border transition-colors ${
            showSoldOutPanel ? "bg-stone-900 text-white border-stone-900" : "bg-white text-stone-600 border-stone-300 hover:bg-stone-50"
          }`}
        >
          品切れ設定{soldOutCount > 0 && <span className="ml-1.5 inline-flex items-center justify-center min-w-[16px] h-4 px-1 rounded-full bg-red-500 text-white text-[10px] font-bold tnum">{soldOutCount}</span>}
        </button>
      </div>

      {/* 品切れ設定パネル（レジへリアルタイム反映） */}
      {showSoldOutPanel && (
        <div className="bg-white rounded-xl border border-stone-200 shadow-[0_1px_3px_rgba(40,33,26,0.05)] p-5">
          <h3 className="text-[11px] font-semibold uppercase tracking-[0.12em] text-stone-400 mb-1 flex items-center gap-1.5">
            品切れ設定
            <InfoTip text="「在庫なし」にするとレジ画面でその商品を注文できなくなります。現場の在庫状況をレジへ即反映できます。" align="left" />
          </h3>
          <p className="text-xs text-stone-400 mb-4">在庫なしにすると、レジ画面から即座に注文できなくなります。</p>
          {menuItems.length === 0 ? (
            <p className="text-sm text-stone-400 text-center py-4">メニューがありません。</p>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {menuItems.map((item) => (
                <button
                  key={item.id}
                  onClick={() => handleToggleSoldOut(item.id, !item.soldOut)}
                  disabled={togglingId === item.id}
                  className={`flex justify-between items-center px-3.5 py-2.5 rounded-lg border text-left transition-all active:scale-[0.99] disabled:opacity-50 ${
                    item.soldOut ? "bg-red-50/60 border-red-200" : "bg-white border-stone-200 hover:border-stone-300"
                  }`}
                >
                  <span className={`text-sm font-medium ${item.soldOut ? "text-red-500 line-through" : "text-stone-800"}`}>{item.name}</span>
                  <span className={`text-[10px] uppercase tracking-wider font-bold px-2 py-0.5 rounded-full ${item.soldOut ? "bg-red-500 text-white" : "bg-emerald-50 text-emerald-600"}`}>
                    {item.soldOut ? "在庫なし" : "販売中"}
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {pendingOrders.length === 0 ? (
        <div className="text-center py-20 bg-white rounded-xl border border-stone-200 shadow-[0_1px_3px_rgba(40,33,26,0.05)] text-stone-400 text-sm">提供待ちの注文はありません</div>
      ) : (
        <>
          {/* 製造タスク集計 */}
          <div className="bg-white rounded-xl border border-stone-200 shadow-[0_1px_3px_rgba(40,33,26,0.05)] p-5">
            <h3 className="text-[11px] font-semibold uppercase tracking-[0.12em] text-stone-400 mb-3 flex items-center gap-2">
              製造タスク
              <span className="normal-case tracking-normal text-stone-800 font-semibold tnum">残り {totalPendingItems} 品</span>
              <InfoTip text="提供待ちの中で、まだ作っていない商品の合計です。商品にチェックを付けるとここから減っていきます。" align="left" />
            </h3>
            {totalPendingItems === 0 ? (
              <p className="text-sm text-emerald-600 font-medium py-1">すべて提供チェック済みです</p>
            ) : (
              <div className="grid grid-cols-2 md:grid-cols-4 gap-2.5">
                {Object.entries(overallSummary).map(([name, data], i) => (
                  <div key={i} className="bg-stone-50 px-3 py-2.5 rounded-lg border border-stone-200">
                    <div className="text-sm font-medium text-stone-800 mb-1 flex items-baseline justify-between gap-1">
                      <span className="truncate">{name}</span>
                      <span className="text-[#688a74] font-semibold tnum shrink-0">{data.total}</span>
                    </div>
                    {Object.keys(data.details).length > 0 && (
                      <div className="flex gap-1.5">
                        {Object.entries(data.details).map(([temp, qty], j) => (
                          <span key={j} className={`text-[10px] font-bold tracking-wide px-1.5 py-0.5 rounded ${temp === "Hot" ? "bg-red-50 text-red-600" : "bg-blue-50 text-blue-600"}`}>
                            {temp === "Hot" ? "HOT" : "ICE"} {qty}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* オーダーカード */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {pendingOrders.map((order) => {
              const elapsedSec = order.createdAt ? (now - order.createdAt.seconds * 1000) / 1000 : 0;
              const urgency = order.createdAt ? elapsedUrgency(elapsedSec) : "normal";
              const u = urgencyStyles[urgency];
              const servedCount = order.items.filter((it) => it.served).length;
              const allServed = order.items.length > 0 && servedCount === order.items.length;
              return (
                <div key={order.id} className={`bg-white p-5 rounded-xl border shadow-sm flex flex-col justify-between min-h-[230px] ${u.card}`}>
                  <div>
                    <div className="flex justify-between items-start mb-3.5 gap-2">
                      <div className="flex flex-col gap-1.5">
                        {order.createdAt && (
                          <span className={`text-[11px] font-semibold px-2 py-0.5 rounded-md w-fit tnum ${u.badge}`}>{formatElapsed(elapsedSec)}経過</span>
                        )}
                        {order.items.length > 1 && (
                          <span className="text-[10px] font-medium text-stone-400 tnum">提供 {servedCount} / {order.items.length}</span>
                        )}
                      </div>
                      {order.ticketNumber && (
                        <div className="text-right shrink-0">
                          <div className="text-[9px] uppercase tracking-[0.12em] text-stone-400 font-semibold">整理番号</div>
                          <div className="text-xl font-semibold text-stone-900 tnum leading-tight">{order.ticketNumber}</div>
                        </div>
                      )}
                    </div>

                    {/* 商品行（個別に提供チェック可能） */}
                    <div className="space-y-1.5 overflow-y-auto max-h-[160px] -mr-1 pr-1">
                      {order.items.map((item) => (
                        <button
                          key={item.id}
                          onClick={() => handleToggleItemServed(order, item.id)}
                          className={`w-full flex items-center gap-2.5 px-2.5 py-2 rounded-lg border text-left transition-all active:scale-[0.99] ${
                            item.served ? "bg-emerald-50/70 border-emerald-200" : "bg-white border-stone-200 hover:border-stone-300"
                          }`}
                        >
                          <span
                            className={`shrink-0 w-5 h-5 rounded-md border flex items-center justify-center ${
                              item.served ? "bg-emerald-500 border-emerald-500 text-white" : "border-stone-300 text-transparent"
                            }`}
                          >
                            <CheckIcon className="w-3 h-3" />
                          </span>
                          {item.temperature && (
                            <span className={`text-[9px] px-1.5 py-0.5 rounded font-bold tracking-wide shrink-0 ${item.temperature === "Hot" ? "bg-red-50 text-red-600" : "bg-blue-50 text-blue-600"}`}>
                              {item.temperature === "Hot" ? "HOT" : "ICE"}
                            </span>
                          )}
                          <span className={`text-sm font-medium flex-1 truncate ${item.served ? "text-stone-400 line-through" : "text-stone-800"}`}>{item.name}</span>
                          <span className="text-sm font-mono font-semibold text-stone-500 tnum shrink-0">×{item.quantity}</span>
                        </button>
                      ))}
                    </div>
                  </div>

                  <button
                    onClick={() => handleComplete(order.id, order.ticketNumber)}
                    disabled={completingId === order.id || !allServed}
                    className="w-full py-2.5 text-white text-sm font-medium tracking-wide rounded-lg transition-colors active:scale-[0.99] mt-4 bg-stone-900 hover:bg-stone-800 disabled:bg-stone-200 disabled:text-stone-400 disabled:cursor-not-allowed"
                  >
                    {completingId === order.id
                      ? "送信中…"
                      : allServed
                      ? "提供完了"
                      : `全商品をチェックで完了  ${servedCount}/${order.items.length}`}
                  </button>
                </div>
              );
            })}
          </div>
        </>
      )}

      {/* 完了した注文（折りたたみ） */}
      <div className="bg-white rounded-xl border border-stone-200 shadow-[0_1px_3px_rgba(40,33,26,0.05)] overflow-hidden">
        <div role="button" tabIndex={0} onClick={() => setShowCompleted((v) => !v)} className="w-full flex justify-between items-center px-5 py-3.5 hover:bg-stone-50 transition-colors cursor-pointer select-none">
          <span className="text-[11px] font-semibold uppercase tracking-[0.12em] text-stone-400 flex items-center gap-2">
            完了した注文
            <span className="normal-case tracking-normal bg-stone-100 text-stone-500 px-2 py-0.5 rounded-full text-xs font-semibold tnum">{completedOrders.length}</span>
            <InfoTip text="提供完了した注文の一覧です。新しく完了したものが上に表示されます。間違えて完了した場合はここから「取消」で提供待ちに戻せます。" align="left" />
          </span>
          <svg viewBox="0 0 12 12" className={`w-3 h-3 text-stone-400 transition-transform ${showCompleted ? "rotate-180" : ""}`} fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M2.5 4.5L6 8l3.5-3.5" />
          </svg>
        </div>

        {showCompleted && (
          <div className="border-t border-stone-200 p-4">
            {completedOrders.length === 0 ? (
              <p className="text-sm text-stone-400 text-center py-4">まだ完了した注文はありません。</p>
            ) : (
              <div className="space-y-1.5">
                {completedOrders.map((order) => {
                  const grouped = groupOrderItems(order.items);
                  const timeStr = order.completedAt
                    ? new Date(order.completedAt.seconds * 1000).toLocaleTimeString("ja-JP", { hour: "2-digit", minute: "2-digit" })
                    : order.createdAt
                    ? new Date(order.createdAt.seconds * 1000).toLocaleTimeString("ja-JP", { hour: "2-digit", minute: "2-digit" })
                    : "";
                  return (
                    <div key={order.id} className="flex justify-between items-center gap-3 px-3.5 py-2.5 rounded-lg border border-stone-100 bg-stone-50/50">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2 mb-0.5">
                          {order.ticketNumber && (
                            <span className="bg-white text-stone-600 px-2 py-0.5 rounded text-xs font-semibold border border-stone-200 tnum">No. {order.ticketNumber}</span>
                          )}
                          {timeStr && <span className="text-[10px] text-stone-400 font-mono tnum">{timeStr} 完了</span>}
                        </div>
                        <div className="text-xs text-stone-500 truncate">
                          {Object.entries(grouped)
                            .map(([name, g]) => `${name} ×${g.total}`)
                            .join("、")}
                        </div>
                      </div>
                      <button onClick={() => handleRevert(order.id)} className="shrink-0 text-xs text-stone-500 hover:text-red-600 hover:border-red-200 border border-stone-300 px-3 py-1.5 rounded-md transition-colors">
                        取消
                      </button>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
