"use client";

import { useState, useMemo, useEffect } from "react";
import { collection, addDoc, serverTimestamp } from "firebase/firestore";
import { db } from "../lib/firebase";
import { CartItem, MenuItem, Order, CatDef, TempOption } from "../lib/types";

import { parseToNumber, computeCompletion, formatElapsed } from "../lib/utils";
import { useToast } from "../lib/toast";
import { InfoTip } from "../lib/info";
import { NumPad } from "../lib/numpad";

// ==========================================
// レジ入力（CashierView）
// ==========================================
export default function CashierView({
  selectedDate,
  menuItems,
  categories,
  isMenuLoading,
  useTicket,
  showAvgTime,
  orders,
  ticketNumber,
  setTicketNumber,
}: {
  selectedDate: string;
  menuItems: MenuItem[];
  categories: CatDef[];
  isMenuLoading: boolean;
  useTicket: boolean;
  showAvgTime: boolean;
  orders: Order[];
  ticketNumber: string;
  setTicketNumber: (value: string) => void;
}) {
  const [cart, setCart] = useState<CartItem[]>([]);
  const [cashReceived, setCashReceived] = useState<number | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  // iPad で OS キーボードを開かせないための画面内テンキー。どの欄に対して開いているか
  const [numpadTarget, setNumpadTarget] = useState<"ticket" | "cash" | null>(null);
  const { showError, showToast } = useToast();

  const RECENT_WINDOW_MS = 30 * 60 * 1000;
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 30000);
    return () => clearInterval(t);
  }, []);

  const completion = useMemo(() => computeCompletion(orders, { sinceMs: now - RECENT_WINDOW_MS }), [orders, now, RECENT_WINDOW_MS]);
  
  const addToCart = (item: MenuItem, temp?: TempOption) => {
    if (item.soldOut) return;
    const price = temp === "Hot" ? (item.hotPrice ?? item.price) : temp === "Ice" ? (item.icePrice ?? item.price) : item.price;
    const cartItemId = `${item.id}-${temp ?? "none"}`;

    setCart((prev) => {
      const existingIndex = prev.findIndex((i) => i.id === cartItemId);
      if (existingIndex > -1) {
        const newCart = [...prev];
        newCart[existingIndex] = { ...newCart[existingIndex], quantity: newCart[existingIndex].quantity + 1 };
        return newCart;
      }
      return [
        ...prev,
        { id: cartItemId, name: item.name, price, category: item.category, quantity: 1, ...(temp && { temperature: temp }) },
      ];
    });
  };

  const updateQuantity = (cartItemId: string, delta: number) => {
    setCart((prev) =>
      prev
        .map((item) => (item.id === cartItemId ? { ...item, quantity: item.quantity + delta } : item))
        .filter((item) => item.quantity > 0)
    );
  };

  const getCartQuantity = (itemId: string, temp?: TempOption) => {
    const cartItemId = `${itemId}-${temp ?? "none"}`;
    const item = cart.find((i) => i.id === cartItemId);
    return item ? item.quantity : 0;
  };

  const totalAmount = cart.reduce((sum, item) => sum + item.price * item.quantity, 0);
  const totalCount = cart.reduce((sum, item) => sum + item.quantity, 0);
  const changeAmount = cashReceived === null ? 0 : cashReceived - totalAmount;
  const isShortOfCash = cashReceived !== null && changeAmount < 0;

  const QUICK_CASH = [1000, 5000, 10000];

  const handleCheckout = async () => {
    if (isSubmitting || cart.length === 0) return;
    const submittedTicket = useTicket ? ticketNumber.trim() : null;
    if (useTicket && !submittedTicket) {
      showError("整理番号を入力してください");
      return;
    }
    if (cashReceived === null) {
      showError("お預かり金額を入力してください");
      return;
    }
    if (isShortOfCash) {
      showError("お預かり金額が足りません");
      return;
    }

    setIsSubmitting(true);
    try {
      // 営業日内の連番（既存注文の最大値 + 1）。時刻由来の擬似番号は衝突しうるため廃止
      const shortOrderNumber = orders.reduce((max, o) => Math.max(max, o.orderNumber || 0), 0) + 1;
      const change = (cashReceived ?? 0) - totalAmount;
      await addDoc(collection(db, "orders"), {
        orderNumber: shortOrderNumber,
        items: cart,
        totalPrice: totalAmount,
        status: "pending",
        date: selectedDate,
        createdAt: serverTimestamp(),
        ticketNumber: submittedTicket,
      });
      setCart([]);
      setCashReceived(null);
      if (useTicket) {
        setTicketNumber(String(parseToNumber(submittedTicket) + 1));
      }
      showToast(`注文を受け付けました${change > 0 ? `（お釣り ¥${change.toLocaleString()}）` : ""}`);
    } catch (e) {
      console.error(e);
      showError("通信エラーが発生しました。再試行してください。");
    } finally {
      setIsSubmitting(false);
    }
  };

  if (isMenuLoading) return <div className="text-center py-24 text-stone-400 text-sm tracking-wide">メニューを読み込み中…</div>;
  if (menuItems.length === 0)
    return (
      <div className="text-center py-20 bg-white rounded-xl border border-stone-200 shadow-[0_1px_3px_rgba(40,33,26,0.05)] text-stone-500 text-sm">
        メニューが設定されていません。右上の「設定」から商品を追加してください。
      </div>
    );

  return (
    <div className="space-y-4">
      {/* 毎回確実にアニメーションさせるための専用CSSスタイル */}
      <style dangerouslySetInnerHTML={{
        __html: `
          @keyframes badge-pop {
            0% { transform: scale(0.8); }
            40% { transform: scale(1.35); }
            100% { transform: scale(1); }
          }
          .animate-pop {
            animation: badge-pop 0.25s cubic-bezier(0.175, 0.885, 0.32, 1.275) forwards;
          }
        `
      }} />

      {showAvgTime && (
        <div className="bg-white rounded-xl border border-stone-200 shadow-[0_1px_3px_rgba(40,33,26,0.05)] px-5 py-3 flex items-center justify-between">
          <span className="text-[11px] font-semibold uppercase tracking-[0.12em] text-stone-400 flex items-center gap-1.5">
            直近30分の平均提供時間
            <InfoTip text="直近30分以内に提供完了した注文の、受注から提供までの平均時間です。時間が経つと古い注文は自動的に集計から外れます。設定でオン / オフを切り替えられます。" align="left" />
          </span>
          {completion.avgSec === null ? (
            <span className="text-sm text-stone-400">直近30分の完了がありません</span>
          ) : (
            <span className="text-lg font-semibold text-stone-900 tnum">
              {formatElapsed(completion.avgSec)}
              <span className="text-xs text-stone-400 font-normal ml-1.5">／ {completion.count}件</span>
            </span>
          )}
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        <div className="lg:col-span-2 space-y-5">
          {categories.map((category) => {
            const itemsInCategory = menuItems.filter((item) => item.category === category.name);
            if (itemsInCategory.length === 0) return null;

            return (
              <section key={category.id} className="bg-white rounded-xl border border-stone-200 shadow-[0_1px_3px_rgba(40,33,26,0.05)] p-5">
                <h2 className="text-[11px] font-semibold uppercase tracking-[0.12em] text-stone-400 mb-4">{category.name}</h2>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                  {itemsInCategory.map((item) => {
                    const hasHot = item.hotPrice != null;
                    const hasIce = item.icePrice != null;
                    const hasTemp = hasHot || hasIce;

                    const hotQty = hasHot ? getCartQuantity(item.id, "Hot") : 0;
                    const iceQty = hasIce ? getCartQuantity(item.id, "Ice") : 0;
                    const normalQty = !hasTemp ? getCartQuantity(item.id) : 0;
                    const isSelectedAny = hotQty > 0 || iceQty > 0 || normalQty > 0;

                    if (hasTemp) {
                      return (
                        <div 
                          key={item.id} 
                          className={`flex flex-col border rounded-lg overflow-hidden transition-all duration-200 ${
                            item.soldOut 
                              ? "border-stone-200" 
                              : isSelectedAny 
                              ? "border-[#8a5a3b] shadow-[0_0_0_1px_rgba(138,90,59,0.4)] z-10" 
                              : "border-stone-200"
                          }`}
                        >
                          <div className={`px-4 pt-3 pb-1.5 flex justify-between items-center transition-colors ${isSelectedAny ? "bg-[#8a5a3b]/[0.03]" : "bg-transparent"}`}>
                            <span className={`text-sm font-medium truncate transition-colors ${item.soldOut ? "text-stone-400 line-through" : isSelectedAny ? "text-[#8a5a3b]" : "text-stone-800"}`}>
                              {item.name}
                            </span>
                            {item.soldOut && <span className="text-[10px] uppercase tracking-wider text-stone-400 font-semibold shrink-0">在庫なし</span>}
                          </div>
                          <div className="flex divide-x divide-stone-200 border-t border-stone-100">
                            {hasHot && (
                              <button
                                onClick={() => addToCart(item, "Hot")}
                                disabled={item.soldOut}
                                className={`flex-1 flex items-center justify-between px-3 py-2.5 transition-all disabled:cursor-not-allowed disabled:opacity-50 ${
                                  hotQty > 0 ? "bg-[#8a5a3b]/[0.08]" : "bg-white hover:bg-red-50/60 active:scale-[0.99]"
                                }`}
                              >
                                <div className="flex items-center gap-1.5">
                                  <span className="text-[10px] font-bold text-red-700 bg-red-100 px-1.5 py-0.5 rounded-full">HOT</span>
                                  {hotQty > 0 && (
                                    <span key={hotQty} className="animate-pop bg-[#8a5a3b] text-white text-[10px] font-bold h-4 min-w-[16px] px-1 flex items-center justify-center rounded-full">
                                      {hotQty}
                                    </span>
                                  )}
                                </div>
                                <span className="text-xs font-mono font-semibold text-stone-500 tnum">¥{item.hotPrice!.toLocaleString()}</span>
                              </button>
                            )}
                            {hasIce && (
                              <button
                                onClick={() => addToCart(item, "Ice")}
                                disabled={item.soldOut}
                                className={`flex-1 flex items-center justify-between px-3 py-2.5 transition-all disabled:cursor-not-allowed disabled:opacity-50 ${
                                  iceQty > 0 ? "bg-[#8a5a3b]/[0.08]" : "bg-white hover:bg-blue-50/60 active:scale-[0.99]"
                                }`}
                              >
                                <div className="flex items-center gap-1.5">
                                  <span className="text-[10px] font-bold text-blue-700 bg-blue-100 px-1.5 py-0.5 rounded-full">ICE</span>
                                  {iceQty > 0 && (
                                    <span key={iceQty} className="animate-pop bg-[#8a5a3b] text-white text-[10px] font-bold h-4 min-w-[16px] px-1 flex items-center justify-center rounded-full">
                                      {iceQty}
                                    </span>
                                  )}
                                </div>
                                <span className="text-xs font-mono font-semibold text-stone-500 tnum">¥{item.icePrice!.toLocaleString()}</span>
                              </button>
                            )}
                          </div>
                        </div>
                      );
                    }

                    // 通常商品
                    return (
                      <button
                        key={item.id}
                        onClick={() => addToCart(item)}
                        disabled={item.soldOut}
                        className={`relative flex justify-between items-center px-4 py-3.5 border rounded-lg text-left transition-all duration-200 ${
                          item.soldOut
                            ? "bg-stone-50 border-stone-200 cursor-not-allowed"
                            : normalQty > 0
                            ? "bg-[#8a5a3b]/[0.04] border-[#8a5a3b] shadow-[0_0_0_1px_rgba(138,90,59,0.4)] z-10"
                            : "bg-white border-stone-200 hover:border-[#8a5a3b]/50 hover:bg-[#8a5a3b]/[0.02] active:scale-[0.99]"
                        }`}
                      >
                        <div className="flex items-center gap-2">
                          <span className={`text-sm font-medium truncate transition-colors ${item.soldOut ? "text-stone-400 line-through" : normalQty > 0 ? "text-[#8a5a3b]" : "text-stone-800"}`}>
                            {item.name}
                          </span>
                          {normalQty > 0 && (
                            <span key={normalQty} className="animate-pop bg-[#8a5a3b] text-white text-[10px] font-bold h-5 min-w-[20px] px-1.5 flex items-center justify-center rounded-full shadow-sm">
                              {normalQty}
                            </span>
                          )}
                        </div>
                        {item.soldOut ? (
                          <span className="text-[10px] uppercase tracking-wider text-stone-400 font-semibold shrink-0">在庫なし</span>
                        ) : (
                          <span className="text-xs font-mono font-semibold text-stone-500 tnum shrink-0">¥{item.price.toLocaleString()}</span>
                        )}
                      </button>
                    );
                  })}
                </div>
              </section>
            );
          })}
        </div>

        <div className="bg-white rounded-xl border border-stone-200 shadow-[0_1px_3px_rgba(40,33,26,0.05)] h-fit sticky top-28 p-5 flex flex-col gap-5">
          {useTicket && (
            <div>
              <label className="text-[11px] font-semibold uppercase tracking-[0.12em] text-stone-400 mb-2 flex items-center gap-1.5">
                整理番号
                <InfoTip text="自動で1ずつ増えていきます。手で書き換えることもでき、その場合は次の注文で「入力した番号 + 1」が表示されます。タブを切り替えても番号は保持されます。" align="left" />
              </label>
              {/* readOnly + 画面内テンキー: iPad で OS のフルキーボードを開かせない */}
              <input
                type="text"
                readOnly
                value={ticketNumber}
                onClick={() => setNumpadTarget("ticket")}
                placeholder="1"
                className={`w-full px-3 py-2.5 text-2xl font-semibold tnum rounded-lg border cursor-pointer transition-shadow ${
                  numpadTarget === "ticket" ? "border-[#8a5a3b] ring-2 ring-[#8a5a3b]/15" : "border-stone-300"
                }`}
              />
            </div>
          )}

          <div>
            <div className="flex justify-between items-center mb-3">
              <h2 className="text-[11px] font-semibold uppercase tracking-[0.12em] text-stone-400 flex items-center gap-1.5">
                選択中の商品
                <InfoTip text="今カートに入っている商品です。＋ / − で数量を変えられます。下のボタンでバリスタ画面に送られます。" align="left" />
              </h2>
              {cart.length > 0 && (
                <button
                  onClick={() => setCart([])}
                  className="text-xs font-medium text-stone-500 border border-stone-300 rounded-md px-2.5 py-1 hover:bg-red-50 hover:text-red-600 hover:border-red-200 transition-colors"
                >
                  すべてクリア
                </button>
              )}
            </div>
            {cart.length === 0 ? (
              <p className="text-stone-400 text-sm text-center py-8">商品を選択してください</p>
            ) : (
              <div className="space-y-2.5 max-h-[28vh] overflow-y-auto -mr-1 pr-1">
                {cart.map((item) => (
                  <div key={item.id} className="flex justify-between items-center gap-2">
                    <div className="min-w-0">
                      <div className="text-sm font-medium text-stone-800 flex items-center gap-1.5 truncate">
                        {item.temperature && (
                          <span className={`text-[9px] px-1.5 py-0.5 rounded font-bold tracking-wide ${item.temperature === "Hot" ? "bg-red-100 text-red-700" : "bg-blue-100 text-blue-700"}`}>
                            {item.temperature === "Hot" ? "HOT" : "ICE"}
                          </span>
                        )}
                        <span className="truncate">{item.name}</span>
                      </div>
                      <div className="text-xs text-stone-400 font-mono tnum mt-0.5">¥{item.price.toLocaleString()}</div>
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                      <button onClick={() => updateQuantity(item.id, -1)} className="w-7 h-7 rounded-md border border-stone-200 text-stone-500 font-medium hover:bg-stone-50 transition-colors">−</button>
                      <span className="font-mono w-6 text-center text-sm font-semibold text-stone-800 tnum">{item.quantity}</span>
                      <button onClick={() => updateQuantity(item.id, 1)} className="w-7 h-7 rounded-md border border-stone-200 text-stone-500 font-medium hover:bg-stone-50 transition-colors">+</button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="border-t border-stone-200 pt-4 space-y-3">
            <div className="flex justify-between items-baseline">
              <span className="text-sm text-stone-500">合計{totalCount > 0 && <span className="text-xs text-stone-400 ml-1">（{totalCount}点）</span>}</span>
              <span className="text-2xl font-semibold tnum text-stone-900 transition-all">¥{totalAmount.toLocaleString()}</span>
            </div>

            <div className="flex justify-between items-center gap-2">
              <span className="text-sm text-stone-500 shrink-0 flex items-center gap-1">
                お預かり
                <InfoTip text="お客様から受け取った金額です。下のボタンで素早く入力でき、お釣りが自動計算されます。お会計金額以上を入力すると送信できます。" align="left" />
              </span>
              <div
                className={`flex items-center bg-white border rounded-lg overflow-hidden transition-shadow ${
                  numpadTarget === "cash" ? "border-[#8a5a3b] ring-2 ring-[#8a5a3b]/15" : "border-stone-300"
                }`}
              >
                <span className="pl-3 text-stone-400 font-mono">¥</span>
                {/* readOnly + 画面内テンキー: iPad で OS のフルキーボードを開かせない */}
                <input
                  type="text"
                  readOnly
                  value={cashReceived === null ? "" : cashReceived.toLocaleString()}
                  onClick={() => setNumpadTarget("cash")}
                  placeholder="0"
                  className="w-24 px-2 py-2 text-right font-mono font-semibold text-lg tnum cursor-pointer focus:outline-none"
                />
              </div>
            </div>

            <div className="flex flex-wrap gap-1.5">
              <button
                onClick={() => setCashReceived(totalAmount)}
                disabled={totalAmount === 0}
                className="flex-1 px-2 py-1.5 text-xs font-semibold text-[#8a5a3b] bg-[#8a5a3b]/[0.08] border border-[#8a5a3b]/20 rounded-md hover:bg-[#8a5a3b]/[0.14] disabled:opacity-40 transition-colors"
              >
                ぴったり
              </button>
              {QUICK_CASH.map((amt) => (
                <button
                  key={amt}
                  onClick={() => setCashReceived((prev) => (prev ?? 0) + amt)}
                  className="flex-1 px-2 py-1.5 text-xs font-semibold text-stone-600 bg-white border border-stone-300 rounded-md hover:bg-stone-50 font-mono tnum whitespace-nowrap transition-colors"
                >
                  +{amt.toLocaleString()}
                </button>
              ))}
            </div>

            <div className="flex justify-between items-center pt-3 border-t border-stone-200">
              <span className="text-sm text-stone-500 flex items-center gap-1">
                お釣り
                <InfoTip text="「お預かり − 合計」を自動計算します。足りない時は赤字で表示され、送信できません。" align="left" />
              </span>
              <span className={`text-xl font-semibold font-mono tnum transition-colors ${isShortOfCash ? "text-red-500" : "text-stone-900"}`}>
                ¥{cashReceived === null ? "0" : changeAmount.toLocaleString()}
              </span>
            </div>
          </div>

          <button
            onClick={handleCheckout}
            disabled={cart.length === 0 || isSubmitting || (useTicket && !ticketNumber.trim()) || cashReceived === null || isShortOfCash}
            className="w-full py-3.5 bg-stone-900 hover:bg-stone-800 text-white font-medium tracking-wide rounded-lg transition-all active:scale-[0.99] disabled:bg-stone-200 disabled:text-stone-400 disabled:cursor-not-allowed"
          >
            {isSubmitting ? "送信中…" : cashReceived === null ? "お預かりを入力してください" : isShortOfCash ? "金額が不足しています" : "注文を送信する"}
          </button>
        </div>
      </div>

      {numpadTarget === "ticket" && (
        <NumPad
          title="整理番号"
          value={ticketNumber}
          onChange={setTicketNumber}
          onClose={() => setNumpadTarget(null)}
        />
      )}
      {numpadTarget === "cash" && (
        <NumPad
          title="お預かり金額"
          prefix="¥"
          value={cashReceived === null ? "" : String(cashReceived)}
          onChange={(v) => setCashReceived(v === "" ? null : Number(v))}
          onClose={() => setNumpadTarget(null)}
        />
      )}
    </div>
  );
}