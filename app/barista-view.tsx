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
// ☕ バリスタ画面（BaristaView）
// 提供待ちオーダーの製造・提供管理。経過時間・品切れ切替・商品別チェック・完了一覧に対応
// ==========================================
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

  // 🔴 提供完了 → 誤タップに備え「元に戻す」トーストを表示（直前の1件を即復帰）
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

  if (isOrdersLoading) return <div className="text-center py-20 text-neutral-500 font-bold">オーダーを読み込み中...</div>;

  const urgencyStyles: Record<string, { card: string; badge: string }> = {
    normal: { card: "border-neutral-200", badge: "bg-neutral-100 text-neutral-500" },
    warn: { card: "border-amber-300 ring-1 ring-amber-200", badge: "bg-amber-100 text-amber-700" },
    danger: { card: "border-red-300 ring-2 ring-red-200", badge: "bg-red-100 text-red-700 animate-pulse" },
  };

  return (
    <div className="space-y-6">
      <div className="bg-white p-4 rounded-2xl border flex flex-wrap gap-3 justify-between items-center shadow-sm">
        <h2 className="font-bold text-neutral-700 flex items-center gap-1.5">
          📥 提供待ち件数
          <InfoTip text="まだ提供していない注文の一覧です。古い注文ほど上に並びます。各注文の「提供完了」を押すと下の完了一覧に移動します。" align="left" />
        </h2>
        <div className="flex items-center gap-3">
          <span className="text-sm text-neutral-500 font-medium">
            残り <span className="font-black text-xl text-cyan-600 font-mono mx-1">{pendingOrders.length}</span> 件
          </span>
          <button
            onClick={() => setShowSoldOutPanel((v) => !v)}
            className={`text-xs font-bold px-3 py-2 rounded-lg border transition-colors ${
              showSoldOutPanel ? "bg-stone-800 text-white border-stone-800" : "bg-white text-neutral-600 border-neutral-300 hover:bg-neutral-50"
            }`}
          >
            🚫 品切れ設定{soldOutCount > 0 && <span className="ml-1 bg-red-500 text-white px-1.5 rounded-full">{soldOutCount}</span>}
          </button>
        </div>
      </div>

      {/* 品切れ設定パネル（レジへリアルタイム反映） */}
      {showSoldOutPanel && (
        <div className="bg-white p-5 rounded-2xl border-2 border-stone-200 shadow-sm">
          <h3 className="font-bold text-neutral-700 text-sm mb-1 flex items-center gap-1.5">
            🚫 品切れ設定
            <InfoTip text="「売切」にするとレジ画面でその商品を注文できなくなります。現場の在庫状況をレジへ即反映できます。" align="left" />
          </h3>
          <p className="text-xs text-neutral-400 mb-4">「売切」にするとレジ画面から即座に注文できなくなります。</p>
          {menuItems.length === 0 ? (
            <p className="text-sm text-neutral-400 text-center py-4">メニューがありません。</p>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {menuItems.map((item) => (
                <button
                  key={item.id}
                  onClick={() => handleToggleSoldOut(item.id, !item.soldOut)}
                  disabled={togglingId === item.id}
                  className={`flex justify-between items-center p-3 rounded-xl border-2 text-left transition-all active:scale-95 disabled:opacity-50 ${
                    item.soldOut ? "bg-red-50 border-red-200" : "bg-white border-neutral-200 hover:border-neutral-300"
                  }`}
                >
                  <span className={`font-bold text-sm ${item.soldOut ? "text-red-500 line-through" : "text-neutral-800"}`}>{item.name}</span>
                  <span className={`text-[11px] font-black px-2.5 py-1 rounded-full ${item.soldOut ? "bg-red-500 text-white" : "bg-emerald-100 text-emerald-700"}`}>
                    {item.soldOut ? "売切中" : "販売中"}
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {pendingOrders.length === 0 ? (
        <div className="text-center py-20 bg-white rounded-2xl border text-neutral-400 text-sm shadow-sm">現在、提供待ちの注文はありません ☕</div>
      ) : (
        <>
          {/* 製造タスク集計 */}
          <div className="bg-orange-50 border-2 border-orange-200 rounded-2xl p-5 shadow-sm">
            <h3 className="font-black text-orange-800 text-sm mb-3 flex items-center gap-2 border-b border-orange-200 pb-2">
              🔥 現在の製造タスク <span className="bg-orange-600 text-white px-2 py-0.5 rounded-full text-xs">残り {totalPendingItems} 品</span>
              <InfoTip text="提供待ちの中で、まだ作っていない商品の合計です。商品にチェックを付けるとここから減っていきます。" align="left" />
            </h3>
            {totalPendingItems === 0 ? (
              <p className="text-sm text-orange-700 font-bold text-center py-2">すべて提供チェック済みです 🎉</p>
            ) : (
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                {Object.entries(overallSummary).map(([name, data], i) => (
                  <div key={i} className="bg-white px-3 py-2 rounded-lg shadow-sm border border-orange-100 flex flex-col justify-center">
                    <div className="font-bold text-neutral-800 text-sm mb-1">
                      {name} <span className="text-orange-600 font-black ml-1">計{data.total}</span>
                    </div>
                    {Object.keys(data.details).length > 0 && (
                      <div className="flex gap-2">
                        {Object.entries(data.details).map(([temp, qty], j) => (
                          <span key={j} className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${temp === "Hot" ? "bg-red-50 text-red-600" : "bg-blue-50 text-blue-600"}`}>
                            {temp} x{qty}
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
                <div key={order.id} className={`bg-white p-5 rounded-2xl border-2 shadow-sm flex flex-col justify-between min-h-[250px] ${u.card}`}>
                  <div>
                    <div className="flex justify-between items-start mb-3 border-b border-neutral-100 pb-2 gap-2">
                      <div className="flex flex-col gap-1.5">
                        {order.createdAt && (
                          <span className={`text-[11px] font-black px-2 py-1 rounded w-fit ${u.badge}`}>⏱ {formatElapsed(elapsedSec)}経過</span>
                        )}
                        {order.items.length > 1 && (
                          <span className="text-[10px] font-bold text-neutral-400">提供 {servedCount}/{order.items.length}</span>
                        )}
                      </div>
                      {order.ticketNumber && (
                        <span className="bg-amber-100 text-amber-800 px-3 py-1 rounded-lg font-black text-lg border border-amber-300 shrink-0">
                          整理番号: {order.ticketNumber}
                        </span>
                      )}
                    </div>

                    {/* 商品行（個別に提供チェック可能） */}
                    <div className="space-y-1.5 overflow-y-auto max-h-[160px] pr-1">
                      {order.items.map((item) => (
                        <button
                          key={item.id}
                          onClick={() => handleToggleItemServed(order, item.id)}
                          className={`w-full flex items-center gap-2 p-2 rounded-lg border text-left transition-all active:scale-[0.98] ${
                            item.served ? "bg-emerald-50 border-emerald-200" : "bg-white border-neutral-200 hover:border-cyan-300"
                          }`}
                        >
                          <span
                            className={`shrink-0 w-5 h-5 rounded-md border-2 flex items-center justify-center text-xs font-black ${
                              item.served ? "bg-emerald-500 border-emerald-500 text-white" : "border-neutral-300 text-transparent"
                            }`}
                          >
                            ✓
                          </span>
                          {item.temperature && (
                            <span className={`text-[10px] px-1.5 py-0.5 rounded font-black shrink-0 ${item.temperature === "Hot" ? "bg-red-100 text-red-600" : "bg-blue-100 text-blue-600"}`}>
                              {item.temperature}
                            </span>
                          )}
                          <span className={`text-sm font-bold flex-1 ${item.served ? "text-neutral-400 line-through" : "text-neutral-800"}`}>{item.name}</span>
                          <span className="text-sm font-mono font-black text-orange-600 bg-orange-50 px-2 py-0.5 rounded shrink-0">x{item.quantity}</span>
                        </button>
                      ))}
                    </div>
                  </div>

                  <button
                    onClick={() => handleComplete(order.id, order.ticketNumber)}
                    disabled={completingId === order.id}
                    className={`w-full py-3 text-white font-bold rounded-xl text-sm transition-all active:scale-95 mt-4 shadow-sm disabled:opacity-50 ${
                      allServed ? "bg-emerald-600 hover:bg-emerald-700" : "bg-cyan-600 hover:bg-cyan-700"
                    }`}
                  >
                    {completingId === order.id ? "送信中..." : allServed ? "全品提供済 → 完了する ✓" : "提供完了 ✓"}
                  </button>
                </div>
              );
            })}
          </div>
        </>
      )}

      {/* 完了した注文（折りたたみ） */}
      <div className="bg-white rounded-2xl border shadow-sm overflow-hidden">
        <button
          onClick={() => setShowCompleted((v) => !v)}
          className="w-full flex justify-between items-center p-4 hover:bg-neutral-50 transition-colors"
        >
          <span className="font-bold text-neutral-700 text-sm flex items-center gap-1.5">
            ✅ 完了した注文
            <span className="bg-neutral-200 text-neutral-600 px-2 py-0.5 rounded-full text-xs font-black">{completedOrders.length}</span>
            <InfoTip text="提供完了した注文の一覧です。新しく完了したものが上に表示されます。間違えて完了した場合はここから「取消」で提供待ちに戻せます。" align="left" />
          </span>
          <span className="text-neutral-400 text-lg">{showCompleted ? "▲" : "▼"}</span>
        </button>

        {showCompleted && (
          <div className="border-t border-neutral-100 p-4">
            {completedOrders.length === 0 ? (
              <p className="text-sm text-neutral-400 text-center py-4">まだ完了した注文はありません。</p>
            ) : (
              <div className="space-y-2">
                {completedOrders.map((order) => {
                  const grouped = groupOrderItems(order.items);
                  const timeStr = order.completedAt
                    ? new Date(order.completedAt.seconds * 1000).toLocaleTimeString("ja-JP", { hour: "2-digit", minute: "2-digit" })
                    : order.createdAt
                    ? new Date(order.createdAt.seconds * 1000).toLocaleTimeString("ja-JP", { hour: "2-digit", minute: "2-digit" })
                    : "";
                  return (
                    <div key={order.id} className="flex justify-between items-center gap-3 p-3 rounded-xl border border-neutral-100 bg-neutral-50/60 opacity-70 hover:opacity-100 transition-opacity">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2 mb-0.5">
                          {order.ticketNumber && (
                            <span className="bg-amber-100 text-amber-700 px-2 py-0.5 rounded text-xs font-black border border-amber-200">🎫 {order.ticketNumber}</span>
                          )}
                          {timeStr && <span className="text-[10px] text-neutral-400 font-mono">{timeStr} 完了</span>}
                        </div>
                        <div className="text-xs font-bold text-neutral-500 truncate">
                          {Object.entries(grouped)
                            .map(([name, g]) => `${name}×${g.total}`)
                            .join("、")}
                        </div>
                      </div>
                      <button
                        onClick={() => handleRevert(order.id)}
                        className="shrink-0 text-xs text-red-500 hover:bg-red-50 border border-red-200 px-3 py-1.5 rounded-lg font-bold transition-colors"
                      >
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
