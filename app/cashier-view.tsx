"use client";

import { useState, useEffect, useRef, useMemo } from "react";
import { collection, addDoc, serverTimestamp } from "firebase/firestore";
import { db } from "../lib/firebase";
import { CartItem, MenuItem, Order, CATEGORIES } from "../lib/types";
import { parseToNumber } from "../lib/utils";
import { useToast } from "../lib/toast";
import { InfoTip } from "../lib/info";

// ==========================================
// 📱 レジ入力（CashierView）
// ==========================================
export default function CashierView({
  selectedDate,
  menuItems,
  isMenuLoading,
  useTicket,
  orders,
  isOrdersLoading,
}: {
  selectedDate: string;
  menuItems: MenuItem[];
  isMenuLoading: boolean;
  useTicket: boolean;
  orders: Order[];
  isOrdersLoading: boolean;
}) {
  const [cart, setCart] = useState<CartItem[]>([]);
  const [selectedTemp, setSelectedTemp] = useState<"Hot" | "Ice">("Hot");
  const [ticketNumber, setTicketNumber] = useState("");
  const [cashReceived, setCashReceived] = useState<number | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const { showError } = useToast();

  // 🔴 整理番号の自動採番: 既存注文の最大番号 + 1（無ければ 1）
  const suggestedStart = useMemo(() => {
    let max = 0;
    orders.forEach((o) => {
      if (o.status === "cancelled" || !o.ticketNumber) return;
      const n = parseToNumber(o.ticketNumber);
      if (n > max) max = n;
    });
    return max + 1;
  }, [orders]);

  const initialized = useRef(false);

  // 営業日を切り替えたら採番をリセット
  useEffect(() => {
    initialized.current = false;
    setTicketNumber("");
  }, [selectedDate]);

  // 注文読み込み後に初期の整理番号をセット（1回だけ）
  useEffect(() => {
    if (useTicket && !isOrdersLoading && !initialized.current) {
      setTicketNumber(String(suggestedStart));
      initialized.current = true;
    }
  }, [useTicket, isOrdersLoading, suggestedStart]);

  const addToCart = (item: MenuItem) => {
    if (item.soldOut) return;
    const isCoffee = item.category === "コーヒー";
    const cartItemId = `${item.id}-${isCoffee ? selectedTemp : "none"}`;

    setCart((prev) => {
      const existingIndex = prev.findIndex((i) => i.id === cartItemId);
      if (existingIndex > -1) {
        const newCart = [...prev];
        newCart[existingIndex] = { ...newCart[existingIndex], quantity: newCart[existingIndex].quantity + 1 };
        return newCart;
      }
      return [
        ...prev,
        {
          id: cartItemId,
          name: item.name,
          price: item.price,
          category: item.category,
          quantity: 1,
          ...(isCoffee && { temperature: selectedTemp }),
        },
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

  const totalAmount = cart.reduce((sum, item) => sum + item.price * item.quantity, 0);
  const totalCount = cart.reduce((sum, item) => sum + item.quantity, 0);
  const changeAmount = cashReceived === null ? 0 : cashReceived - totalAmount;
  const isShortOfCash = cashReceived !== null && changeAmount < 0;

  const QUICK_CASH = [1000, 5000, 10000];

  const handleCheckout = async () => {
    if (isSubmitting || cart.length === 0) return;
    const submittedTicket = useTicket ? ticketNumber.trim() : null;
    if (useTicket && !submittedTicket) {
      showError("整理番号を入力してください！");
      return;
    }
    if (isShortOfCash) {
      showError("お預かり金額が足りません！");
      return;
    }

    setIsSubmitting(true);
    try {
      const shortOrderNumber = Date.now() % 10000;
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
      // 🔴 次の整理番号をサジェスト（入力値 + 1）
      if (useTicket) {
        setTicketNumber(String(parseToNumber(submittedTicket) + 1));
      }
    } catch (e) {
      console.error(e);
      showError("通信エラーが発生しました。再試行してください。");
    } finally {
      setIsSubmitting(false);
    }
  };

  if (isMenuLoading) return <div className="text-center py-20 text-neutral-500 font-bold">メニューを読み込み中...</div>;
  if (menuItems.length === 0)
    return (
      <div className="text-center py-20 bg-white rounded-2xl border font-bold text-neutral-600">
        メニューが設定されていません。上の「⚙️ 設定」から追加してください。
      </div>
    );

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
      {/* 商品選択 */}
      <div className="lg:col-span-2 space-y-6">
        {CATEGORIES.map((category) => {
          const itemsInCategory = menuItems.filter((item) => item.category === category);
          if (itemsInCategory.length === 0) return null;
          const isCoffee = category === "コーヒー";

          return (
            <div key={category} className="bg-white p-4 rounded-2xl border border-neutral-200 shadow-sm">
              <div className="flex justify-between items-center mb-4 pb-2 border-b border-neutral-100">
                <h3 className="font-bold text-neutral-700 flex items-center gap-1.5">
                  {category}
                  {isCoffee && <InfoTip text="商品ボタンを押すとカゴに追加されます。コーヒーは右のHOT/ICEを選んでから押すと、その温度で追加されます。" align="left" />}
                </h3>
                {isCoffee && (
                  <div className="flex items-center gap-1.5">
                    <div className="flex bg-neutral-100 rounded-lg p-0.5 text-xs font-bold">
                      <button
                        onClick={() => setSelectedTemp("Hot")}
                        className={`px-4 py-1.5 rounded-md transition-all ${selectedTemp === "Hot" ? "bg-white text-red-600 shadow-sm" : "text-neutral-500"}`}
                      >
                        HOT
                      </button>
                      <button
                        onClick={() => setSelectedTemp("Ice")}
                        className={`px-4 py-1.5 rounded-md transition-all ${selectedTemp === "Ice" ? "bg-white text-blue-600 shadow-sm" : "text-neutral-500"}`}
                      >
                        ICE
                      </button>
                    </div>
                    <InfoTip text="コーヒーの温度を選びます。ここで選んだ温度で、下の商品ボタンがカゴに入ります。" align="right" />
                  </div>
                )}
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {itemsInCategory.map((item) => (
                  <button
                    key={item.id}
                    onClick={() => addToCart(item)}
                    disabled={item.soldOut}
                    className={`relative flex justify-between items-center p-4 border-2 rounded-xl text-left transition-all shadow-sm ${
                      item.soldOut
                        ? "bg-neutral-100 border-neutral-100 cursor-not-allowed opacity-60"
                        : "bg-white hover:bg-orange-50 hover:border-orange-200 border-neutral-100 active:scale-95"
                    }`}
                  >
                    <span className={`font-bold text-sm ${item.soldOut ? "text-neutral-400 line-through" : "text-neutral-800"}`}>
                      {item.name}
                    </span>
                    {item.soldOut ? (
                      <span className="text-[10px] bg-neutral-500 text-white px-2 py-1 rounded-md font-black">売切</span>
                    ) : (
                      <span className="text-xs bg-neutral-100 px-2.5 py-1 rounded-md font-mono font-bold text-neutral-600">{item.price}円</span>
                    )}
                  </button>
                ))}
              </div>
            </div>
          );
        })}
      </div>

      {/* 会計パネル */}
      <div className="bg-white p-5 rounded-2xl border border-neutral-200 h-fit sticky top-24 shadow-sm flex flex-col gap-4">
        {useTicket && (
          <div className="bg-amber-50 p-4 rounded-xl border-2 border-amber-200">
            <label className="text-amber-800 font-bold text-sm mb-2 flex items-center gap-1.5">
              🎫 整理番号
              <InfoTip text="自動で1ずつ増えていきます。手で書き換えることもでき、その場合は次の注文で「入力した番号+1」が表示されます。" align="left" />
            </label>
            <input
              type="text"
              value={ticketNumber}
              onChange={(e) => setTicketNumber(e.target.value)}
              placeholder="例: 1"
              className="w-full p-3 text-xl font-black rounded-lg border border-amber-300 focus:outline-none focus:ring-2 focus:ring-amber-500"
            />
          </div>
        )}

        <div>
          <div className="flex justify-between items-center mb-3 pb-2 border-b border-neutral-100">
            <h3 className="font-bold text-neutral-700 flex items-center gap-1.5">
              🛒 現在の選択
              <InfoTip text="今カゴに入っている商品です。＋／－で数量を変えられます。下の「注文を送信する」でバリスタ画面に送られます。" align="left" />
            </h3>
            {cart.length > 0 && (
              <button onClick={() => setCart([])} className="text-xs text-neutral-400 hover:text-red-500 font-bold transition-colors">
                クリア
              </button>
            )}
          </div>
          {cart.length === 0 ? (
            <p className="text-neutral-400 text-sm text-center py-6">商品を選択してください</p>
          ) : (
            <div className="space-y-3 mb-2 max-h-[25vh] overflow-y-auto pr-2">
              {cart.map((item) => (
                <div key={item.id} className="flex justify-between items-center text-sm border-b border-neutral-50 pb-3">
                  <div className="pr-2">
                    <div className="font-bold text-neutral-800 flex items-center gap-1.5 mb-0.5">
                      {item.temperature && (
                        <span className={`text-[10px] px-1.5 py-0.5 rounded font-black ${item.temperature === "Hot" ? "bg-red-100 text-red-600" : "bg-blue-100 text-blue-600"}`}>
                          {item.temperature}
                        </span>
                      )}
                      {item.name}
                    </div>
                    <div className="text-xs text-neutral-400 font-mono">{item.price}円</div>
                  </div>
                  <div className="flex items-center space-x-2 bg-neutral-50 p-1 rounded-lg border border-neutral-200 shrink-0">
                    <button onClick={() => updateQuantity(item.id, -1)} className="w-7 h-7 bg-white border border-neutral-200 rounded font-bold hover:bg-neutral-100">-</button>
                    <span className="font-mono w-5 text-center font-bold text-neutral-700">{item.quantity}</span>
                    <button onClick={() => updateQuantity(item.id, 1)} className="w-7 h-7 bg-white border border-neutral-200 rounded font-bold hover:bg-neutral-100">+</button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="bg-neutral-50 p-4 rounded-xl border border-neutral-200 space-y-3">
          <div className="flex justify-between items-center">
            <span className="text-sm font-bold text-neutral-500">お会計金額 {totalCount > 0 && <span className="text-xs">（{totalCount}点）</span>}</span>
            <span className="text-2xl font-black font-mono text-neutral-800">¥{totalAmount.toLocaleString()}</span>
          </div>

          <div className="flex justify-between items-center gap-2">
            <span className="text-sm font-bold text-neutral-500 shrink-0 flex items-center gap-1">
              お預かり
              <InfoTip text="お客様から受け取った金額です。下のボタンで素早く入力でき、お釣りが自動計算されます。" align="left" />
            </span>
            <div className="flex items-center bg-white border border-neutral-300 rounded overflow-hidden focus-within:border-orange-500 focus-within:ring-1 focus-within:ring-orange-500">
              <span className="pl-3 text-neutral-500 font-mono font-bold">¥</span>
              <input
                type="number"
                value={cashReceived === null ? "" : cashReceived}
                onChange={(e) => setCashReceived(e.target.value === "" ? null : Number(e.target.value))}
                placeholder="0"
                className="w-24 p-2 text-right font-mono font-black text-lg focus:outline-none"
              />
            </div>
          </div>

          <div className="flex flex-wrap gap-1.5">
            <button
              onClick={() => setCashReceived(totalAmount)}
              disabled={totalAmount === 0}
              className="flex-1 px-2 py-1.5 text-xs font-bold bg-orange-100 text-orange-700 border border-orange-200 rounded hover:bg-orange-200 disabled:opacity-50"
            >
              ぴったり
            </button>
            {QUICK_CASH.map((amt) => (
              <button
                key={amt}
                onClick={() => setCashReceived((prev) => (prev ?? 0) + amt)}
                className="flex-1 px-2 py-1.5 text-xs font-bold bg-white border border-neutral-300 rounded hover:bg-neutral-100 font-mono whitespace-nowrap"
              >
                +{amt.toLocaleString()}
              </button>
            ))}
          </div>

          <div className="flex justify-between items-center pt-3 border-t border-neutral-200">
            <span className="text-sm font-bold text-neutral-500 flex items-center gap-1">
              お釣り
              <InfoTip text="「お預かり − お会計金額」を自動計算します。足りない時は赤字で表示され、送信できません。" align="left" />
            </span>
            <span className={`text-2xl font-black font-mono ${isShortOfCash ? "text-red-500" : "text-emerald-600"}`}>
              ¥{cashReceived === null ? "0" : changeAmount.toLocaleString()}
            </span>
          </div>
        </div>

        <button
          onClick={handleCheckout}
          disabled={cart.length === 0 || isSubmitting || (useTicket && !ticketNumber.trim()) || isShortOfCash}
          className="w-full py-4 bg-orange-600 hover:bg-orange-700 text-white font-bold rounded-xl transition-all active:scale-95 disabled:bg-neutral-200 disabled:text-neutral-400 text-lg shadow-md"
        >
          {isSubmitting ? "送信中..." : isShortOfCash ? "金額が不足しています" : "注文を送信する"}
        </button>
      </div>
    </div>
  );
}
