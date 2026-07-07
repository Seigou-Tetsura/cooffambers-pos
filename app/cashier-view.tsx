"use client";

import { useState, useMemo, useEffect } from "react";
import { collection, addDoc, serverTimestamp } from "firebase/firestore";
import { db } from "../lib/firebase";
import { CartItem, MenuItem, Order, CatDef, TempOption } from "../lib/types";

import { parseToNumber, computeCompletion, formatElapsed, baseItemId } from "../lib/utils";
import { mutateMenu } from "../lib/menu";
import { useToast } from "../lib/toast";
import { InfoTip } from "../lib/info";

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
  
  // 【追加】どちらの入力欄（お預かり金 or 整理番号）にテンキーを効かせるかの状態
  const [activeInput, setActiveInput] = useState<"cash" | "ticket">("cash");

  const { showError, showToast } = useToast();

  const RECENT_WINDOW_MS = 30 * 60 * 1000;
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 30000);
    return () => clearInterval(t);
  }, []);

  const completion = useMemo(() => computeCompletion(orders, { sinceMs: now - RECENT_WINDOW_MS }), [orders, now, RECENT_WINDOW_MS]);
  
  // 商品ごとのカート内合計数（HOT/ICE をまたいで在庫と照合するため、元の商品ID単位で集計）
  const cartQtyByBase = useMemo(() => {
    const map: Record<string, number> = {};
    cart.forEach((ci) => {
      const base = baseItemId(ci.id);
      map[base] = (map[base] || 0) + ci.quantity;
    });
    return map;
  }, [cart]);

  // 在庫管理中の商品の「カート分を除いた残り」。在庫管理していない商品は null
  const remainingOf = (item: MenuItem): number | null =>
    item.stock == null ? null : Math.max(0, item.stock - (cartQtyByBase[item.id] || 0));

  const addToCart = (item: MenuItem, temp?: TempOption) => {
    if (item.soldOut) return;
    if (item.stock != null && (cartQtyByBase[item.id] || 0) >= item.stock) return; // 在庫の上限
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
    if (delta > 0) {
      const base = baseItemId(cartItemId);
      const menuItem = menuItems.find((m) => m.id === base);
      if (menuItem?.stock != null && (cartQtyByBase[base] || 0) >= menuItem.stock) {
        showError("在庫の上限に達しています");
        return;
      }
    }
    setCart((prev) =>
      prev
        .map((item) => (item.id === cartItemId ? { ...item, quantity: item.quantity + delta } : item))
        .filter((item) => item.quantity > 0)
    );
  };

  // 「その場でお渡し済み」のトグル（お菓子などレジで手渡す商品用。バリスタ画面に製造タスクとして出なくなる）
  const toggleServed = (cartItemId: string) => {
    setCart((prev) => prev.map((item) => (item.id === cartItemId ? { ...item, served: !item.served } : item)));
  };

  const getCartQuantity = (itemId: string, temp?: TempOption) => {
    const cartItemId = `${itemId}-${temp ?? "none"}`;
    const item = cart.find((i) => i.id === cartItemId);
    return item ? item.quantity : 0;
  };

  // 【追加】自作テンキーの入力処理
  const handleKeypad = (val: string) => {
    if (activeInput === "cash") {
      if (val === "BS") {
        if (cashReceived !== null) {
          const str = cashReceived.toString();
          setCashReceived(str.length > 1 ? Number(str.slice(0, -1)) : null);
        }
      } else {
        const currentStr = cashReceived === null ? "" : cashReceived.toString();
        const newStr = currentStr + val;
        // 異常な桁数（1000万円以上など）の入力を防ぐ
        if (newStr.length <= 7) setCashReceived(Number(newStr));
      }
    } else if (activeInput === "ticket") {
      if (val === "BS") {
        setTicketNumber(ticketNumber.slice(0, -1));
      } else {
        if (ticketNumber.length <= 4) setTicketNumber(ticketNumber + val);
      }
    }
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
      // 全品レジで受け渡し済みなら、バリスタを経由せずそのまま提供完了として登録する
      const allHanded = cart.every((i) => i.served);
      await addDoc(collection(db, "orders"), {
        orderNumber: shortOrderNumber,
        items: cart,
        totalPrice: totalAmount,
        status: allHanded ? "completed" : "pending",
        date: selectedDate,
        createdAt: serverTimestamp(),
        ticketNumber: submittedTicket,
        ...(allHanded && { completedAt: serverTimestamp(), handedAtRegister: true }),
      });
      // 在庫管理中の商品の在庫を減算（注文の登録とは別トランザクションなので、失敗しても注文自体は成立）
      const stockDeltas = Object.entries(cartQtyByBase)
        .filter(([baseId]) => menuItems.find((m) => m.id === baseId)?.stock != null)
        .map(([baseId, qty]) => ({ id: baseId, qty }));
      if (stockDeltas.length > 0) {
        try {
          await mutateMenu(selectedDate, { type: "consumeStock", deltas: stockDeltas });
        } catch (e) {
          console.error("在庫減算エラー:", e);
          showError("注文は登録されましたが、在庫数の更新に失敗しました。在庫・品切れ画面で数を確認してください。");
        }
      }
      setCart([]);
      setCashReceived(null);
      setActiveInput("cash"); // 会計完了後はデフォルトでお預かり金フォーカスに戻す
      if (useTicket) {
        setTicketNumber(String(parseToNumber(submittedTicket) + 1));
      }
      showToast(`注文を受け付けました${allHanded ? "（全品お渡し済み）" : ""}${change > 0 ? `（お釣り ¥${change.toLocaleString()}）` : ""}`);
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
            <InfoTip text="直近30分以内に提供完了した注文の、受注から提供までの平均時間です。" align="left" />
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

                    // 在庫管理中の商品：残数バッジを出し、売り切れたら押せなくする
                    const remaining = remainingOf(item);
                    const outOfStock = remaining === 0;
                    const unavailable = item.soldOut || outOfStock;
                    const stockBadge =
                      remaining !== null && !item.soldOut ? (
                        <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full shrink-0 tnum ${outOfStock ? "bg-red-100 text-red-600" : remaining <= 5 ? "bg-amber-100 text-amber-700" : "bg-stone-100 text-stone-500"}`}>
                          {outOfStock ? "売切" : `残 ${remaining}`}
                        </span>
                      ) : null;

                    if (hasTemp) {
                      return (
                        <div key={item.id} className={`flex flex-col border rounded-lg overflow-hidden transition-all duration-200 ${unavailable ? "border-stone-200" : isSelectedAny ? "border-[#8a5a3b] shadow-[0_0_0_1px_rgba(138,90,59,0.4)] z-10" : "border-stone-200"}`}>
                          <div className={`px-4 pt-3 pb-1.5 flex justify-between items-center gap-2 transition-colors ${isSelectedAny ? "bg-[#8a5a3b]/[0.03]" : "bg-transparent"}`}>
                            <span className={`text-sm font-medium truncate transition-colors ${item.soldOut ? "text-stone-400 line-through" : isSelectedAny ? "text-[#8a5a3b]" : "text-stone-800"}`}>{item.name}</span>
                            {item.soldOut ? <span className="text-[10px] uppercase tracking-wider text-stone-400 font-semibold shrink-0">在庫なし</span> : stockBadge}
                          </div>
                          <div className="flex divide-x divide-stone-200 border-t border-stone-100">
                            {hasHot && (
                              <button onClick={() => addToCart(item, "Hot")} disabled={unavailable} className={`flex-1 flex items-center justify-between px-3 py-2.5 transition-all disabled:cursor-not-allowed disabled:opacity-50 ${hotQty > 0 ? "bg-[#8a5a3b]/[0.08]" : "bg-white hover:bg-red-50/60 active:scale-[0.99]"}`}>
                                <div className="flex items-center gap-1.5">
                                  <span className="text-[10px] font-bold text-red-700 bg-red-100 px-1.5 py-0.5 rounded-full">HOT</span>
                                  {hotQty > 0 && <span key={hotQty} className="animate-pop bg-[#8a5a3b] text-white text-[10px] font-bold h-4 min-w-[16px] px-1 flex items-center justify-center rounded-full">{hotQty}</span>}
                                </div>
                                <span className="text-xs font-mono font-semibold text-stone-500 tnum">¥{item.hotPrice!.toLocaleString()}</span>
                              </button>
                            )}
                            {hasIce && (
                              <button onClick={() => addToCart(item, "Ice")} disabled={unavailable} className={`flex-1 flex items-center justify-between px-3 py-2.5 transition-all disabled:cursor-not-allowed disabled:opacity-50 ${iceQty > 0 ? "bg-[#8a5a3b]/[0.08]" : "bg-white hover:bg-blue-50/60 active:scale-[0.99]"}`}>
                                <div className="flex items-center gap-1.5">
                                  <span className="text-[10px] font-bold text-blue-700 bg-blue-100 px-1.5 py-0.5 rounded-full">ICE</span>
                                  {iceQty > 0 && <span key={iceQty} className="animate-pop bg-[#8a5a3b] text-white text-[10px] font-bold h-4 min-w-[16px] px-1 flex items-center justify-center rounded-full">{iceQty}</span>}
                                </div>
                                <span className="text-xs font-mono font-semibold text-stone-500 tnum">¥{item.icePrice!.toLocaleString()}</span>
                              </button>
                            )}
                          </div>
                        </div>
                      );
                    }

                    return (
                      <button key={item.id} onClick={() => addToCart(item)} disabled={unavailable} className={`relative flex justify-between items-center px-4 py-3.5 border rounded-lg text-left transition-all duration-200 ${unavailable ? "bg-stone-50 border-stone-200 cursor-not-allowed" : normalQty > 0 ? "bg-[#8a5a3b]/[0.04] border-[#8a5a3b] shadow-[0_0_0_1px_rgba(138,90,59,0.4)] z-10" : "bg-white border-stone-200 hover:border-[#8a5a3b]/50 hover:bg-[#8a5a3b]/[0.02] active:scale-[0.99]"}`}>
                        <div className="flex items-center gap-2 min-w-0">
                          <span className={`text-sm font-medium truncate transition-colors ${item.soldOut ? "text-stone-400 line-through" : normalQty > 0 ? "text-[#8a5a3b]" : "text-stone-800"}`}>{item.name}</span>
                          {normalQty > 0 && <span key={normalQty} className="animate-pop bg-[#8a5a3b] text-white text-[10px] font-bold h-5 min-w-[20px] px-1.5 flex items-center justify-center rounded-full shadow-sm">{normalQty}</span>}
                          {stockBadge}
                        </div>
                        {item.soldOut ? <span className="text-[10px] uppercase tracking-wider text-stone-400 font-semibold shrink-0">在庫なし</span> : <span className="text-xs font-mono font-semibold text-stone-500 tnum shrink-0">¥{item.price.toLocaleString()}</span>}
                      </button>
                    );
                  })}
                </div>
              </section>
            );
          })}
        </div>

        {/* 会計パネル */}
        <div className="bg-white rounded-xl border border-stone-200 shadow-[0_1px_3px_rgba(40,33,26,0.05)] h-fit sticky top-28 p-5 flex flex-col gap-5">
          
          {/* 【変更点】入力欄（divで実装しキーボードを完全に封じる） */}
          <div className="flex gap-3">
            {useTicket && (
              <div className="flex-1">
                <label className="text-[10px] font-semibold uppercase tracking-[0.12em] text-stone-400 mb-1.5 block">整理番号</label>
                <div
                  onClick={() => setActiveInput("ticket")}
                  className={`w-full px-3 py-2.5 text-xl font-semibold tnum rounded-lg border cursor-pointer transition-colors flex items-center ${activeInput === "ticket" ? "border-[#8a5a3b] ring-2 ring-[#8a5a3b]/15 bg-[#8a5a3b]/[0.03] text-[#8a5a3b]" : "border-stone-300 text-stone-900 bg-white"}`}
                >
                  {ticketNumber || <span className="text-stone-400 font-normal">1</span>}
                </div>
              </div>
            )}
            
            <div className="flex-[2]">
              <label className="text-[10px] font-semibold uppercase tracking-[0.12em] text-stone-400 mb-1.5 block">お預かり金</label>
              <div
                onClick={() => setActiveInput("cash")}
                className={`flex items-center w-full border rounded-lg overflow-hidden cursor-pointer transition-colors h-[46px] ${activeInput === "cash" ? "border-[#8a5a3b] ring-2 ring-[#8a5a3b]/15 bg-[#8a5a3b]/[0.03]" : "border-stone-300 bg-white"}`}
              >
                <span className={`pl-3 font-mono ${activeInput === "cash" ? "text-[#8a5a3b]" : "text-stone-400"}`}>¥</span>
                <div className={`flex-1 px-3 py-2 text-right font-mono font-semibold text-xl tnum ${activeInput === "cash" ? "text-[#8a5a3b]" : "text-stone-900"}`}>
                  {cashReceived === null ? <span className="text-stone-400 font-normal">0</span> : cashReceived.toLocaleString()}
                </div>
              </div>
            </div>
          </div>

          <div>
            <div className="flex justify-between items-center mb-3">
              <h2 className="text-[11px] font-semibold uppercase tracking-[0.12em] text-stone-400 flex items-center gap-1.5">選択中の商品</h2>
              {cart.length > 0 && <button onClick={() => setCart([])} className="text-xs font-medium text-stone-500 border border-stone-300 rounded-md px-2.5 py-1 hover:bg-red-50 hover:text-red-600 hover:border-red-200 transition-colors">すべてクリア</button>}
            </div>
            {cart.length === 0 ? (
              <p className="text-stone-400 text-sm text-center py-6">商品を選択してください</p>
            ) : (
              <div className="space-y-2.5 max-h-[16vh] overflow-y-auto -mr-1 pr-1">
                {cart.map((item) => (
                  <div key={item.id} className="flex justify-between items-center gap-2">
                    <div className="min-w-0">
                      <div className="text-sm font-medium text-stone-800 flex items-center gap-1.5 truncate">
                        {item.temperature && <span className={`text-[9px] px-1.5 py-0.5 rounded font-bold tracking-wide ${item.temperature === "Hot" ? "bg-red-100 text-red-700" : "bg-blue-100 text-blue-700"}`}>{item.temperature === "Hot" ? "HOT" : "ICE"}</span>}
                        <span className="truncate">{item.name}</span>
                      </div>
                      <div className="text-xs text-stone-400 font-mono tnum mt-0.5">¥{item.price.toLocaleString()}</div>
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                      <button
                        onClick={() => toggleServed(item.id)}
                        title="その場でお渡し済みにする（バリスタの製造タスクに出ません）"
                        className={`text-[10px] font-bold px-2 h-7 rounded-full border transition-colors mr-0.5 ${
                          item.served ? "bg-emerald-500 border-emerald-500 text-white" : "bg-white border-stone-300 text-stone-400 hover:border-emerald-300 hover:text-emerald-600"
                        }`}
                      >
                        {item.served ? "✓ 受渡済" : "受渡"}
                      </button>
                      <button onClick={() => updateQuantity(item.id, -1)} className="w-7 h-7 rounded-md border border-stone-200 text-stone-500 font-medium hover:bg-stone-50 transition-colors">−</button>
                      <span className="font-mono w-6 text-center text-sm font-semibold text-stone-800 tnum">{item.quantity}</span>
                      <button onClick={() => updateQuantity(item.id, 1)} className="w-7 h-7 rounded-md border border-stone-200 text-stone-500 font-medium hover:bg-stone-50 transition-colors">+</button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="border-t border-stone-200 pt-3 space-y-3">
            <div className="flex justify-between items-baseline">
              <span className="text-sm text-stone-500">合計{totalCount > 0 && <span className="text-xs text-stone-400 ml-1">（{totalCount}点）</span>}</span>
              <span className="text-2xl font-semibold tnum text-stone-900 transition-all">¥{totalAmount.toLocaleString()}</span>
            </div>

            {/* クイック入力ボタン */}
            <div className="flex flex-wrap gap-1.5">
              <button onClick={() => { setCashReceived(totalAmount); setActiveInput("cash"); }} disabled={totalAmount === 0} className="flex-1 px-2 py-2 text-xs font-semibold text-[#8a5a3b] bg-[#8a5a3b]/[0.08] border border-[#8a5a3b]/20 rounded-md hover:bg-[#8a5a3b]/[0.14] disabled:opacity-40 transition-colors">
                ぴったり
              </button>
              <button onClick={() => { setCashReceived(null); setActiveInput("cash"); }} className="px-3 py-2 text-xs font-semibold text-stone-500 bg-white border border-stone-300 rounded-md hover:bg-stone-50 transition-colors">
                クリア
              </button>
              {QUICK_CASH.map((amt) => (
                <button key={amt} onClick={() => { setCashReceived((prev) => (prev ?? 0) + amt); setActiveInput("cash"); }} className="flex-1 px-1 py-2 text-xs font-semibold text-stone-600 bg-white border border-stone-300 rounded-md hover:bg-stone-50 font-mono tnum whitespace-nowrap transition-colors">
                  +{amt.toLocaleString()}
                </button>
              ))}
            </div>

            {/* 【追加】画面内 自作テンキー */}
            <div className="grid grid-cols-3 gap-1.5 mt-2">
              {["7", "8", "9", "4", "5", "6", "1", "2", "3", "0", "00", "BS"].map((key) => (
                <button
                  key={key}
                  onClick={() => handleKeypad(key)}
                  className="py-3 text-xl font-semibold text-stone-700 bg-white border border-stone-200 rounded-lg shadow-sm hover:bg-stone-50 active:bg-stone-200 active:scale-[0.96] transition-all font-mono tnum flex items-center justify-center"
                >
                  {key === "BS" ? <span className="text-xl">⌫</span> : key}
                </button>
              ))}
            </div>

            <div className="flex justify-between items-center pt-3 border-t border-stone-200">
              <span className="text-sm text-stone-500 flex items-center gap-1">お釣り</span>
              <span className={`text-xl font-semibold font-mono tnum transition-colors ${isShortOfCash ? "text-red-500" : "text-stone-900"}`}>
                ¥{cashReceived === null ? "0" : changeAmount.toLocaleString()}
              </span>
            </div>
          </div>

          <button
            onClick={handleCheckout}
            disabled={cart.length === 0 || isSubmitting || (useTicket && !ticketNumber.trim()) || cashReceived === null || isShortOfCash}
            className="w-full py-4 bg-stone-900 hover:bg-stone-800 text-white font-semibold text-lg tracking-wide rounded-lg transition-all active:scale-[0.98] disabled:bg-stone-200 disabled:text-stone-400 disabled:cursor-not-allowed shadow-md"
          >
            {isSubmitting ? "送信中…" : cashReceived === null ? "お預かりを入力" : isShortOfCash ? "金額が不足" : "注文を送信する"}
          </button>
        </div>
      </div>
    </div>
  );
}