"use client";

import { useState, useEffect, useMemo, useRef, useCallback } from "react";
import { collection, addDoc, serverTimestamp, query, where, orderBy, onSnapshot, doc, updateDoc, runTransaction, Timestamp } from "firebase/firestore";
import { db } from "../lib/firebase";

// ==========================================
// 1. 厳格な型定義（Types）
// ==========================================
type Mode = "cashier" | "barista" | "dashboard" | "settings";

interface MenuItem {
  id: string;
  name: string;
  price: number;
  category: string;
}

interface RawMenuItem {
  id: string | number;
  name: string;
  price: string | number;
  category: string;
}

interface CartItem {
  id: string;
  name: string;
  price: number;
  temperature?: "Hot" | "Ice";
  quantity: number;
  category: string;
}

interface Order {
  id: string;
  orderNumber: number;
  items: CartItem[];
  totalPrice: number;
  status: "pending" | "completed" | "cancelled"; // 🔴 物理削除を廃止し「取消済」ステータスを追加
  date: string;
  createdAt: Timestamp | null;
  ticketNumber?: string;
}

// ==========================================
// 2. 共通ロジック関数（Utils）
// ==========================================
const parseToNumber = (val: string | number | null | undefined): number => {
  if (val === undefined || val === null) return 0;
  const halfVal = String(val).replace(/[０-９]/g, (s) => String.fromCharCode(s.charCodeAt(0) - 0xFEE0));
  const numStr = halfVal.replace(/[^0-9]/g, "");
  const num = parseInt(numStr, 10);
  return isNaN(num) ? 0 : num;
};

const groupOrderItems = (items: CartItem[] | undefined) => {
  if (!items) return {};
  return items.reduce((acc, item) => {
    if (!acc[item.name]) acc[item.name] = { total: 0, subItems: [] };
    acc[item.name].total += item.quantity;
    if (item.temperature) acc[item.name].subItems.push(item);
    return acc;
  }, {} as Record<string, { total: number; subItems: CartItem[] }>);
};

// 🔴 CSV破損防止のためのエスケープ関数
const escapeCsv = (str: string | number) => `"${String(str).replace(/"/g, '""')}"`;

// ==========================================
// 3. カスタムフック（Hooks）
// ==========================================
const useErrorMessage = () => {
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  // 🔴 NodeJS.Timeoutを廃止し、Next.jsクライアント推奨の型へ変更
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const showError = useCallback((msg: string) => {
    setErrorMsg(msg);
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      setErrorMsg(null);
      timerRef.current = null;
    }, 3000);
  }, []);

  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  return { errorMsg, showError };
};

// ==========================================
// 4. メイン親コンポーネント（App Core）
// ==========================================
export default function App() {
  const [mode, setMode] = useState<Mode>("cashier");
  const [selectedDate, setSelectedDate] = useState(() => new Date().toISOString().split("T")[0]);
  
  const [orders, setOrders] = useState<Order[]>([]);
  const [menuItems, setMenuItems] = useState<MenuItem[]>([]);
  const [useTicket, setUseTicket] = useState(false);
  
  // 🔴 画面のチラつき防止用ローディングステートを分離
  const [isOrdersLoading, setIsOrdersLoading] = useState(true);
  const [isMenuLoading, setIsMenuLoading] = useState(true);

  useEffect(() => {
    setIsOrdersLoading(true);
    const q = query(collection(db, "orders"), where("date", "==", selectedDate), orderBy("createdAt", "asc"));
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const data: Order[] = [];
      snapshot.forEach((doc) => data.push({ id: doc.id, ...doc.data() } as Order));
      setOrders(data);
      setIsOrdersLoading(false);
    }, (error) => {
      console.error("Firestore Subscribe Error:", error);
      setIsOrdersLoading(false);
    });
    return () => unsubscribe();
  }, [selectedDate]);

  useEffect(() => {
    setIsMenuLoading(true);
    const menuRef = doc(db, "menus", selectedDate);
    const unsubscribe = onSnapshot(menuRef, (docSnap) => {
      if (docSnap.exists()) {
        const rawItems = (docSnap.data().items || []) as RawMenuItem[];
        const safeItems: MenuItem[] = rawItems.map((item) => ({
          id: String(item.id),
          name: String(item.name),
          price: parseToNumber(item.price),
          category: String(item.category),
        }));
        setMenuItems(safeItems);
        setUseTicket(docSnap.data().useTicket || false);
      } else {
        setMenuItems([]);
        setUseTicket(false);
      }
      setIsMenuLoading(false);
    });
    return () => unsubscribe();
  }, [selectedDate]);

  const pendingOrdersCount = useMemo(() => {
    return orders.filter(o => o.status === "pending").length;
  }, [orders]);

  return (
    <div className="min-h-screen bg-neutral-50 text-neutral-800 font-sans antialiased">
      <nav className="bg-white border-b border-neutral-200 sticky top-0 z-50 shadow-sm">
        <div className="max-w-6xl mx-auto flex flex-col sm:flex-row justify-between items-center px-4">
          <div className="py-3 sm:py-4 font-bold text-lg tracking-wider text-neutral-700 w-full sm:w-auto text-center sm:text-left">
            クーファンバーズシステム
          </div>
          <div className="flex space-x-1 overflow-x-auto w-full sm:w-auto pb-1 sm:pb-0">
            {["cashier", "barista", "dashboard", "settings"].map((m) => {
              const labels: Record<Mode, string> = { cashier: "レジ入力", barista: `バリスタ (${pendingOrdersCount})`, dashboard: "売上明細", settings: "⚙️ 設定" };
              const navStyles: Record<Mode, { active: string, inactive: string }> = {
                cashier: { active: "border-orange-600 text-orange-600 font-bold", inactive: "border-transparent text-neutral-500 hover:text-neutral-800" },
                barista: { active: "border-cyan-600 text-cyan-600 font-bold", inactive: "border-transparent text-neutral-500 hover:text-neutral-800" },
                dashboard: { active: "border-stone-800 text-stone-800 font-bold", inactive: "border-transparent text-neutral-500 hover:text-neutral-800" },
                settings: { active: "border-emerald-600 text-emerald-600 font-bold", inactive: "border-transparent text-neutral-500 hover:text-neutral-800" }
              };
              const currentMode = m as Mode;
              const isActive = mode === currentMode;
              return (
                <button key={m} onClick={() => setMode(currentMode)} className={`whitespace-nowrap px-3 sm:px-4 py-3 sm:py-4 text-sm font-medium border-b-2 transition-colors ${isActive ? navStyles[currentMode].active : navStyles[currentMode].inactive}`}>
                  {labels[currentMode]}
                </button>
              );
            })}
          </div>
        </div>
      </nav>

      <div className="bg-white border-b border-neutral-200 px-4 py-2 text-right">
        <div className="max-w-6xl mx-auto flex items-center justify-end space-x-2 text-sm text-neutral-500">
          <span>📅 対象の営業日:</span>
          <input type="date" value={selectedDate} onChange={(e) => setSelectedDate(e.target.value)} className="border border-neutral-300 rounded px-2 py-1 text-neutral-800 bg-neutral-50 font-medium focus:outline-none focus:border-orange-500" />
        </div>
      </div>

      <main className="max-w-6xl mx-auto p-4 md:p-6">
        {mode === "cashier" && <CashierView selectedDate={selectedDate} menuItems={menuItems} isMenuLoading={isMenuLoading} useTicket={useTicket} />}
        {mode === "barista" && <BaristaView orders={orders} isOrdersLoading={isOrdersLoading} />}
        {mode === "dashboard" && <DashboardView orders={orders} selectedDate={selectedDate} />}
        {mode === "settings" && <SettingsView selectedDate={selectedDate} menuItems={menuItems} useTicket={useTicket} />}
      </main>
    </div>
  );
}

// ==========================================
// 📱 画面部品: レジ入力（CashierView）
// ==========================================
function CashierView({ selectedDate, menuItems, isMenuLoading, useTicket }: { selectedDate: string, menuItems: MenuItem[], isMenuLoading: boolean, useTicket: boolean }) {
  const [cart, setCart] = useState<CartItem[]>([]);
  const [selectedTemp, setSelectedTemp] = useState<"Hot" | "Ice">("Hot");
  const [ticketNumber, setTicketNumber] = useState("");
  const [cashReceived, setCashReceived] = useState<number | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const { errorMsg, showError } = useErrorMessage();

  const displayCategories = ["コーヒー", "お菓子", "その他"];

  const addToCart = (item: MenuItem) => {
    const isCoffee = item.category === "コーヒー";
    // 🔴 数量変更時に壊れないよう、一意なIDで管理
    const cartItemId = `${item.id}-${isCoffee ? selectedTemp : 'none'}`;
    
    setCart((prev) => {
      const existingIndex = prev.findIndex((i) => i.id === cartItemId);
      if (existingIndex > -1) {
        const newCart = [...prev];
        newCart[existingIndex].quantity += 1;
        return newCart;
      }
      return [...prev, { 
        id: cartItemId, 
        name: item.name, 
        price: item.price, 
        category: item.category, 
        quantity: 1, 
        ...(isCoffee && { temperature: selectedTemp }) 
      }];
    });
  };

  const updateQuantity = (cartItemId: string, delta: number) => {
    setCart((prev) => {
      return prev.map(item => {
        if (item.id === cartItemId) {
          return { ...item, quantity: item.quantity + delta };
        }
        return item;
      }).filter(item => item.quantity > 0);
    });
  };

  const totalAmount = cart.reduce((sum, item) => sum + (item.price * item.quantity), 0);
  const changeAmount = cashReceived === null ? 0 : cashReceived - totalAmount;
  const isShortOfCash = cashReceived !== null && changeAmount < 0;

  const handleCheckout = async () => {
    if (isSubmitting) return; 
    if (cart.length === 0) return;
    if (useTicket && !ticketNumber.trim()) {
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
        ticketNumber: useTicket ? ticketNumber.trim() : null,
      });
      setCart([]);
      setTicketNumber("");
      setCashReceived(null);
    } catch (e) {
      console.error(e);
      showError("通信エラーが発生しました。再試行してください。");
    } finally {
      setIsSubmitting(false);
    }
  };

  if (isMenuLoading) return <div className="text-center py-20 text-neutral-500 font-bold">メニューを読み込み中...</div>;
  if (menuItems.length === 0) return <div className="text-center py-20 bg-white rounded-xl border font-bold">メニューが設定されていません。上の「⚙️ 設定」から追加してください。</div>;

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 relative">
      {errorMsg && (
        <div className="absolute top-0 left-1/2 -translate-x-1/2 z-10 bg-red-50 text-red-600 text-sm font-bold px-4 py-2 rounded-lg border border-red-200 shadow-md animate-pulse">
          {errorMsg}
        </div>
      )}

      <div className="lg:col-span-2 space-y-6 mt-2">
        {displayCategories.map(category => {
          const itemsInCategory = menuItems.filter(item => item.category === category);
          if (itemsInCategory.length === 0) return null; 
          const isCoffee = category === "コーヒー";

          return (
            <div key={category} className="bg-white p-4 rounded-xl border border-neutral-200 shadow-sm">
              <div className="flex justify-between items-center mb-4 pb-2 border-b border-neutral-100">
                <h3 className="font-bold text-neutral-700">{category}</h3>
                {isCoffee && (
                  <div className="flex bg-neutral-100 rounded-lg p-0.5 text-xs font-bold">
                    <button onClick={() => setSelectedTemp("Hot")} className={`px-4 py-1.5 rounded-md transition-all ${selectedTemp === "Hot" ? "bg-white text-red-600 shadow-sm" : "text-neutral-500"}`}>HOT</button>
                    <button onClick={() => setSelectedTemp("Ice")} className={`px-4 py-1.5 rounded-md transition-all ${selectedTemp === "Ice" ? "bg-white text-blue-600 shadow-sm" : "text-neutral-500"}`}>ICE</button>
                  </div>
                )}
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {itemsInCategory.map((item) => (
                  <button key={item.id} onClick={() => addToCart(item)} className="flex justify-between items-center p-4 bg-white hover:bg-neutral-50 border-2 border-neutral-100 rounded-xl text-left transition-all active:scale-95 shadow-sm">
                    <span className="font-bold text-sm text-neutral-800">{item.name}</span>
                    <span className="text-xs bg-neutral-100 px-2.5 py-1 rounded-md font-mono font-bold text-neutral-600">{item.price}円</span>
                  </button>
                ))}
              </div>
            </div>
          );
        })}
      </div>

      <div className="bg-white p-5 rounded-xl border border-neutral-200 h-fit sticky top-24 shadow-sm flex flex-col gap-4 mt-2">
        {useTicket && (
          <div className="bg-amber-50 p-4 rounded-xl border-2 border-amber-200">
            <label className="block text-amber-800 font-bold text-sm mb-2">🎫 整理番号</label>
            <input type="text" value={ticketNumber} onChange={(e) => setTicketNumber(e.target.value)} placeholder="例: 1, A-10" className="w-full p-3 text-xl font-black rounded-lg border border-amber-300 focus:outline-none focus:ring-2 focus:ring-amber-500" />
          </div>
        )}

        <div>
          <h3 className="font-bold text-neutral-700 mb-3 pb-2 border-b border-neutral-100">🛒 現在の選択</h3>
          {cart.length === 0 ? (
            <p className="text-neutral-400 text-sm text-center py-6">商品を選択してください</p>
          ) : (
            <div className="space-y-3 mb-4 max-h-[25vh] overflow-y-auto pr-2">
              {cart.map((item) => (
                <div key={item.id} className="flex justify-between items-center text-sm border-b border-neutral-50 pb-3">
                  <div className="pr-2">
                    <div className="font-bold text-neutral-800 flex items-center gap-1.5 mb-0.5">
                      {item.temperature && <span className={`text-[10px] px-1.5 py-0.5 rounded font-black ${item.temperature === "Hot" ? "bg-red-100 text-red-600" : "bg-blue-100 text-blue-600"}`}>{item.temperature}</span>}
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
            <span className="text-sm font-bold text-neutral-500">お会計金額</span>
            <span className="text-2xl font-black font-mono text-neutral-800">¥{totalAmount.toLocaleString()}</span>
          </div>

          <div className="flex justify-between items-center">
            <span className="text-sm font-bold text-neutral-500">お預かり</span>
            <div className="flex items-center gap-2">
              <button onClick={() => setCashReceived(totalAmount)} disabled={totalAmount === 0} className="px-2 py-1.5 text-xs font-bold bg-white border border-neutral-300 rounded hover:bg-neutral-100 disabled:opacity-50">
                ぴったり
              </button>
              <div className="flex items-center bg-white border border-neutral-300 rounded overflow-hidden focus-within:border-orange-500 focus-within:ring-1 focus-within:ring-orange-500">
                <span className="pl-3 text-neutral-500 font-mono font-bold">¥</span>
                <input type="number" value={cashReceived === null ? "" : cashReceived} onChange={(e) => setCashReceived(e.target.value === "" ? null : Number(e.target.value))} placeholder="0" className="w-20 p-2 text-right font-mono font-black text-lg focus:outline-none" />
              </div>
            </div>
          </div>

          <div className="flex justify-between items-center pt-3 border-t border-neutral-200">
            <span className="text-sm font-bold text-neutral-500">お釣り</span>
            <span className={`text-2xl font-black font-mono ${isShortOfCash ? "text-red-500" : "text-emerald-600"}`}>
              ¥{cashReceived === null ? "0" : changeAmount.toLocaleString()}
            </span>
          </div>
        </div>

        <button onClick={handleCheckout} disabled={cart.length === 0 || isSubmitting || (useTicket && !ticketNumber.trim()) || isShortOfCash} className="w-full py-4 bg-orange-600 hover:bg-orange-700 text-white font-bold rounded-xl transition-all active:scale-95 disabled:bg-neutral-200 disabled:text-neutral-400 text-lg shadow-md mt-2">
          {isSubmitting ? "送信中..." : isShortOfCash ? "金額が不足しています" : "注文を送信する"}
        </button>
      </div>
    </div>
  );
}

// ==========================================
// ☕ 画面部品: バリスタ画面（BaristaView）
// ==========================================
function BaristaView({ orders, isOrdersLoading }: { orders: Order[], isOrdersLoading: boolean }) {
  const { errorMsg, showError } = useErrorMessage();
  const [completingId, setCompletingId] = useState<string | null>(null); 

  const pendingOrders = useMemo(() => {
    return orders.filter((o) => o.status === "pending");
  }, [orders]);

  const handleComplete = async (id: string) => {
    if (completingId) return; 
    setCompletingId(id);
    try { 
      await updateDoc(doc(db, "orders", id), { status: "completed" }); 
    } catch (e) { 
      console.error(e); 
      showError("ステータスの更新に失敗しました。");
    } finally {
      setCompletingId(null);
    }
  };

  const overallSummary = useMemo(() => {
    const summary: Record<string, { total: number; details: Record<string, number> }> = {};
    pendingOrders.forEach(order => {
      order.items?.forEach(item => {
        if (!summary[item.name]) summary[item.name] = { total: 0, details: {} };
        summary[item.name].total += item.quantity;
        if (item.temperature) {
          summary[item.name].details[item.temperature] = (summary[item.name].details[item.temperature] || 0) + item.quantity;
        }
      });
    });
    return summary;
  }, [pendingOrders]);

  const totalPendingItems = useMemo(() => {
    return pendingOrders.reduce((sum, order) => sum + (order.items?.reduce((s, item) => s + item.quantity, 0) || 0), 0);
  }, [pendingOrders]);

  if (isOrdersLoading) return <div className="text-center py-20 text-neutral-500 font-bold">オーダーを読み込み中...</div>;

  return (
    <div className="space-y-6 relative">
      {errorMsg && (
        <div className="absolute top-0 left-1/2 -translate-x-1/2 z-10 bg-red-50 text-red-600 text-sm font-bold px-4 py-2 rounded-lg border border-red-200 shadow-md animate-pulse">
          {errorMsg}
        </div>
      )}

      <div className="bg-white p-4 rounded-xl border flex justify-between items-center shadow-sm mt-2">
        <h2 className="font-bold text-neutral-700">📥 抽出待ちオーダー</h2>
        <span className="text-sm text-neutral-500 font-medium">残り <span className="font-black text-xl text-cyan-600 font-mono mx-1">{pendingOrders.length}</span> 件</span>
      </div>

      {pendingOrders.length === 0 ? (
        <div className="text-center py-20 bg-white rounded-xl border text-neutral-400 text-sm shadow-sm">現在、待機中の注文はありません ☕</div>
      ) : (
        <>
          <div className="bg-orange-50 border-2 border-orange-200 rounded-xl p-5 shadow-sm">
            <h3 className="font-black text-orange-800 text-sm mb-3 flex items-center gap-2 border-b border-orange-200 pb-2">
              🔥 現在の製造タスク <span className="bg-orange-600 text-white px-2 py-0.5 rounded-full text-xs">合計 {totalPendingItems} 品</span>
            </h3>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              {Object.entries(overallSummary).map(([name, data], i) => (
                <div key={i} className="bg-white px-3 py-2 rounded-lg shadow-sm border border-orange-100 flex flex-col justify-center">
                  <div className="font-bold text-neutral-800 text-sm mb-1">{name} <span className="text-orange-600 font-black ml-1">計{data.total}</span></div>
                  {Object.keys(data.details).length > 0 && (
                    <div className="flex gap-2">
                      {Object.entries(data.details).map(([temp, qty], j) => (
                        <span key={j} className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${temp === 'Hot' ? 'bg-red-50 text-red-600' : 'bg-blue-50 text-blue-600'}`}>{temp} x{qty}</span>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {pendingOrders.map((order) => {
              const groupedItems = groupOrderItems(order.items);
              return (
                <div key={order.id} className="bg-white p-5 rounded-xl border-2 border-neutral-200 shadow-sm flex flex-col justify-between min-h-[250px]">
                  <div>
                    <div className="flex justify-between items-start mb-3 border-b border-neutral-100 pb-2">
                      <span className="text-xs text-neutral-400 font-bold bg-neutral-100 px-2 py-1 rounded">注文 #{order.orderNumber || "---"}</span>
                      {order.ticketNumber && <span className="bg-amber-100 text-amber-800 px-3 py-1 rounded-lg font-black text-lg border border-amber-300">整理番号: {order.ticketNumber}</span>}
                    </div>
                    <div className="space-y-3 overflow-y-auto max-h-[150px] pr-1">
                      {Object.entries(groupedItems).map(([name, group], i) => (
                        <div key={i} className="border-b border-neutral-50 pb-2 last:border-0">
                          <div className="flex justify-between items-center mb-1">
                            <span className="text-sm sm:text-base font-bold text-neutral-800">{name}</span>
                            <span className="text-sm font-mono font-black text-orange-600 bg-orange-50 px-2 py-0.5 rounded">計 {group.total}</span>
                          </div>
                          {group.subItems.length > 0 && (
                            <div className="flex flex-wrap gap-2 pl-2 border-l-2 border-neutral-200">
                              {group.subItems.map((subItem, j) => (
                                <div key={j} className="text-xs font-bold text-neutral-500 flex items-center">
                                  <span className={`mr-1 px-1.5 py-0.5 rounded text-[10px] ${subItem.temperature === "Hot" ? "bg-red-50 text-red-600" : "bg-blue-50 text-blue-600"}`}>{subItem.temperature}</span> x{subItem.quantity}
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                  <button 
                    onClick={() => handleComplete(order.id)} 
                    disabled={completingId === order.id}
                    className="w-full py-3 bg-cyan-600 hover:bg-cyan-700 text-white font-bold rounded-xl text-sm transition-all active:scale-95 mt-4 shadow-sm disabled:opacity-50"
                  >
                    {completingId === order.id ? "送信中..." : "提供完了 ✓"}
                  </button>
                </div>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}

// ==========================================
// 📊 画面部品: 売上明細（DashboardView）
// ==========================================
function DashboardView({ orders, selectedDate }: { orders: Order[], selectedDate: string }) {
  const { errorMsg, showError } = useErrorMessage();
  const [selectedHourTab, setSelectedHourTab] = useState<string>("");
  const [isCancelling, setIsCancelling] = useState<string | null>(null);
  const [confirmCancelId, setConfirmCancelId] = useState<string | null>(null); 

  useEffect(() => {
    setSelectedHourTab("");
    setConfirmCancelId(null);
  }, [selectedDate]);

  // 🔴 グラフエラーを防ぐため createdAt が存在するものだけをパースしてキャッシュ
  const parsedOrders = useMemo(() => {
    return orders.filter(o => o.createdAt).map(o => {
      const dateObj = new Date(o.createdAt!.seconds * 1000);
      return {
        ...o,
        hour: dateObj.getHours(),
        timeStr: dateObj.toLocaleTimeString("ja-JP", { hour: "2-digit", minute: "2-digit" }),
        hourStr: `${dateObj.getHours()}時`
      };
    });
  }, [orders]);

  // 取消された注文を除外した「有効な注文」のリスト（売上計算・ランキング用）
  const validParsedOrders = useMemo(() => {
    return parsedOrders.filter(o => o.status !== "cancelled");
  }, [parsedOrders]);

  const groupedOrdersMap = useMemo(() => {
    return Object.fromEntries(
      parsedOrders.map(o => [o.id, groupOrderItems(o.items)])
    );
  }, [parsedOrders]);

  // 🔴 物理削除を廃止し、ステータスを「取消済 (cancelled)」に変更する処理
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

  const hourlyData = useMemo(() => {
    if (validParsedOrders.length === 0) return [];
    
    const minHour = Math.min(...validParsedOrders.map(o => o.hour));
    const maxHour = Math.max(...validParsedOrders.map(o => o.hour));

    const hours: Record<string, number> = {};
    for (let i = Math.max(0, minHour - 1); i <= Math.min(23, maxHour + 1); i++) {
      hours[`${i}:00`] = 0;
    }

    validParsedOrders.forEach(o => {
      if (hours[`${o.hour}:00`] !== undefined) hours[`${o.hour}:00`] += 1;
    });

    return Object.entries(hours).sort((a, b) => parseInt(a[0]) - parseInt(b[0]));
  }, [validParsedOrders]);

  const maxHourlyCount = useMemo(() => {
    return Math.max(...hourlyData.map(d => d[1]), 1);
  }, [hourlyData]);

  const hourlyProductDetails = useMemo(() => {
    const details: Record<string, Record<string, number>> = {};
    validParsedOrders.forEach(o => {
      const hourKey = `${o.hour}:00台`;
      if (!details[hourKey]) details[hourKey] = {};
      o.items?.forEach(item => {
        const label = item.temperature ? `${item.name} (${item.temperature})` : item.name;
        details[hourKey][label] = (details[hourKey][label] || 0) + item.quantity;
      });
    });
    return details;
  }, [validParsedOrders]);

  const activeHoursList = useMemo(() => {
    return Object.keys(hourlyProductDetails).sort((a, b) => parseInt(a) - parseInt(b));
  }, [hourlyProductDetails]);

  useEffect(() => {
    if (activeHoursList.length > 0 && !selectedHourTab) {
      setSelectedHourTab(activeHoursList[0]);
    }
  }, [activeHoursList, selectedHourTab]);

  const totalSales = useMemo(() => {
    return validParsedOrders.reduce((sum, o) => sum + o.totalPrice, 0);
  }, [validParsedOrders]);

  const orderedItemRanking = useMemo(() => {
    const counts: Record<string, number> = {};
    validParsedOrders.forEach((o) => {
      o.items?.forEach((item) => {
        const label = item.temperature ? `${item.name} (${item.temperature})` : item.name;
        counts[label] = (counts[label] || 0) + item.quantity;
      });
    });
    return Object.entries(counts).sort((a, b) => b[1] - a[1]);
  }, [validParsedOrders]);

  const handleExportCSV = () => {
    if (parsedOrders.length === 0) {
      showError("エクスポートするデータがありません。");
      return;
    }
    
    const headers = ["注文番号", "注文日時", "時間帯(時)", "整理券", "カテゴリ", "商品名", "温度", "数量", "単価", "小計", "ステータス"];
    const rows: string[] = [];
    
    parsedOrders.forEach((order) => {
      const ticket = order.ticketNumber || "";
      const status = order.status === "completed" ? "提供済" : order.status === "cancelled" ? "取消済" : "未対応";

      order.items.forEach(item => {
        const subTotal = item.price * item.quantity;
        const rowData = [
          escapeCsv(`注文 #${order.orderNumber || '---'}`), 
          escapeCsv(order.timeStr),
          escapeCsv(order.hourStr),
          escapeCsv(ticket),
          escapeCsv(item.category || ""),
          escapeCsv(item.name),
          escapeCsv(item.temperature || ""),
          item.quantity,
          item.price,
          subTotal,
          escapeCsv(status)
        ];
        rows.push(rowData.join(","));
      });
    });
    
    const csvContent = "\uFEFF" + [headers.join(","), ...rows].join("\n"); 
    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;

    const now = new Date();
    const timeSuffix = `${String(now.getHours()).padStart(2, '0')}-${String(now.getMinutes()).padStart(2, '0')}`;
    link.setAttribute("download", `売上明細_${selectedDate}_${timeSuffix}.csv`);
    
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-6 relative">
      {errorMsg && (
        <div className="absolute top-0 left-1/2 -translate-x-1/2 z-10 bg-red-50 text-red-600 text-sm font-bold px-4 py-2 rounded-lg border border-red-200 shadow-md animate-pulse">
          {errorMsg}
        </div>
      )}

      <div className="grid grid-cols-2 gap-4 mt-2">
        <div className="bg-white p-5 rounded-xl border shadow-sm">
          <div className="text-xs text-neutral-400 font-bold mb-1">本日の総売上 <span className="text-[10px] font-normal">※取消除く</span></div>
          <div className="text-2xl sm:text-3xl font-black font-mono text-neutral-800">¥{totalSales.toLocaleString()}</div>
        </div>
        <div className="bg-white p-5 rounded-xl border shadow-sm">
          <div className="text-xs text-neutral-400 font-bold mb-1">有効注文数</div>
          <div className="text-2xl sm:text-3xl font-black font-mono text-neutral-800">{validParsedOrders.length} <span className="text-lg text-neutral-500 font-sans">件</span></div>
        </div>
      </div>

      <div className="bg-white p-5 rounded-xl border shadow-sm">
        <h3 className="font-bold text-neutral-700 mb-4 text-sm border-b pb-2">⏰ 時間帯別の注文数（混雑状況）</h3>
        {validParsedOrders.length === 0 ? (
          <p className="text-neutral-400 text-sm text-center py-6">データがありません</p>
        ) : (
          <div className="flex items-end gap-1 sm:gap-2 h-40 mt-6 pt-6 border-b border-neutral-200">
            {hourlyData.map(([time, count]) => {
              const heightPercent = maxHourlyCount > 0 ? (count / maxHourlyCount) * 100 : 0;
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

      <div className="bg-white p-5 rounded-xl border shadow-sm">
        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3 mb-4 border-b pb-2">
          <h3 className="font-bold text-neutral-700 text-sm">🕒 時間帯別の売れ行き詳細</h3>
          {activeHoursList.length > 0 && (
            <div className="flex items-center gap-2 text-sm">
              <span className="text-neutral-500 font-medium">時間帯を選択:</span>
              <select value={selectedHourTab} onChange={(e) => setSelectedHourTab(e.target.value)} className="border rounded p-1 text-neutral-800 font-bold bg-neutral-50 focus:outline-none focus:border-orange-500">
                {activeHoursList.map(h => <option key={h} value={h}>{h}</option>)}
              </select>
            </div>
          )}
        </div>

        {validParsedOrders.length === 0 ? (
          <p className="text-neutral-400 text-sm text-center py-6">データがありません</p>
        ) : !selectedHourTab || !hourlyProductDetails[selectedHourTab] ? (
          <p className="text-neutral-400 text-sm text-center py-6">販売データがありません</p>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-8 gap-y-2 text-sm bg-neutral-50 p-4 rounded-xl border">
            {Object.entries(hourlyProductDetails[selectedHourTab]).sort((a, b) => b[1] - a[1]).map(([itemName, qty]) => (
              <div key={itemName} className="flex justify-between items-center py-2 border-b border-neutral-200 last:border-0 bg-white px-3 rounded-lg shadow-sm">
                <span className="text-neutral-700 font-bold">{itemName}</span>
                <span className="font-black font-mono text-orange-600 bg-orange-50 px-2.5 py-0.5 rounded text-xs">{qty} 個</span>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="bg-white p-5 rounded-xl border shadow-sm">
        <h3 className="font-bold text-neutral-700 mb-4 text-sm border-b pb-2">🏆 人気商品ランキング</h3>
        {orderedItemRanking.length === 0 ? (
          <p className="text-neutral-400 text-sm text-center py-6">データがありません</p>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-8 gap-y-3 text-sm">
            {orderedItemRanking.map(([name, count], index) => (
              <div key={name} className="flex justify-between items-center py-2 border-b border-neutral-50 bg-white px-3 rounded-lg border shadow-sm">
                <div className="flex items-center gap-2">
                  <span className={`w-5 h-5 flex items-center justify-center rounded-full text-xs font-black text-white ${index === 0 ? "bg-amber-400" : index === 1 ? "bg-stone-400" : index === 2 ? "bg-amber-600" : "bg-neutral-300"}`}>{index + 1}</span>
                  <span className="text-neutral-700 font-bold">{name}</span>
                </div>
                <span className="font-black font-mono text-neutral-800 bg-neutral-100 px-2 py-0.5 rounded">{count} 個</span>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="bg-white rounded-xl border overflow-hidden shadow-sm">
        <div className="p-4 bg-neutral-50 border-b flex justify-between items-center">
          <h3 className="font-bold text-neutral-700 text-sm">📑 取引明細一覧</h3>
          <button onClick={handleExportCSV} className="text-xs bg-stone-800 hover:bg-stone-700 text-white font-bold py-1.5 px-3 rounded flex items-center transition-colors shadow-sm">
            📥 CSVでエクスポート
          </button>
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
                <tr><td colSpan={5} className="p-8 text-center text-neutral-400 text-sm">取引履歴がありません</td></tr>
              ) : (
                // 新しい注文が上に来るように逆順で表示（ソート自体はFirestoreで担保されている前提）
                [...parsedOrders].reverse().map((order) => {
                  const groupedItems = groupedOrdersMap[order.id] || {}; 
                  const isCancelled = order.status === "cancelled";

                  return (
                    <tr key={order.id} className={`hover:bg-neutral-50/50 transition-colors ${isCancelled ? "opacity-50 bg-neutral-50" : ""}`}>
                      <td className="p-3 align-top pt-4">
                        <div className={`font-mono text-xs font-medium ${isCancelled ? "text-neutral-400 line-through" : "text-neutral-500"}`}>{order.timeStr}</div>
                        <div className="font-bold text-[10px] text-neutral-400 mt-0.5">注文 #{order.orderNumber || "---"}</div>
                        {order.ticketNumber && <div className="mt-1 inline-block bg-amber-100 text-amber-700 px-1.5 py-0.5 rounded text-[10px] font-bold border border-amber-200">🎫 {order.ticketNumber}</div>}
                      </td>
                      <td className="p-3">
                        <div className={`space-y-1 ${isCancelled ? "line-through grayscale" : ""}`}>
                          {Object.entries(groupedItems).map(([name, group], i) => (
                             <div key={i} className="text-xs font-bold text-neutral-700">
                               {name} <span className="text-orange-500 font-mono ml-1">計{group.total}</span>
                               {group.subItems.length > 0 && (
                                 <span className="text-neutral-400 font-normal ml-1">({group.subItems.map(s => `${s.temperature}x${s.quantity}`).join(", ")})</span>
                               )}
                             </div>
                          ))}
                        </div>
                      </td>
                      <td className="p-3 align-top pt-4">
                        {isCancelled ? (
                          <span className="text-[10px] px-2 py-1 rounded font-black bg-neutral-200 text-neutral-500">取消済</span>
                        ) : (
                          <span className={`text-[10px] px-2 py-1 rounded font-black ${order.status === "completed" ? "bg-emerald-100 text-emerald-700" : "bg-amber-100 text-amber-700"}`}>{order.status === "completed" ? "提供済" : "未対応"}</span>
                        )}
                      </td>
                      <td className={`p-3 text-right font-black font-mono align-top pt-4 ${isCancelled ? "text-neutral-400 line-through" : "text-neutral-700"}`}>¥{order.totalPrice.toLocaleString()}</td>
                      <td className="p-3 text-center align-top pt-3">
                        {!isCancelled && (
                          confirmCancelId === order.id ? (
                            <div className="flex flex-col sm:flex-row items-center justify-center gap-1 bg-red-50 p-1 rounded border border-red-200">
                              <span className="text-[10px] text-red-700 font-bold block mb-1 sm:mb-0">本当に取消？</span>
                              <div className="flex gap-1">
                                <button onClick={() => handleCancelOrder(order.id)} disabled={isCancelling === order.id} className="text-[10px] bg-red-600 text-white px-2 py-0.5 rounded font-bold hover:bg-red-700 disabled:opacity-50">はい</button>
                                <button onClick={() => setConfirmCancelId(null)} disabled={isCancelling === order.id} className="text-[10px] bg-neutral-200 text-neutral-700 px-2 py-0.5 rounded font-bold hover:bg-neutral-300">戻る</button>
                              </div>
                            </div>
                          ) : (
                            <button onClick={() => setConfirmCancelId(order.id)} className="text-xs text-red-500 hover:bg-red-50 border border-red-200 px-2 py-1 rounded font-bold transition-colors">取消</button>
                          )
                        )}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

// ==========================================
// ⚙️ 画面部品: メニュー設定（SettingsView）
// ==========================================
function SettingsView({ selectedDate, menuItems, useTicket }: { selectedDate: string, menuItems: MenuItem[], useTicket: boolean }) {
  const [newItemName, setNewItemName] = useState("");
  const [newItemPrice, setNewItemPrice] = useState<string>("");
  const [newItemCategory, setNewItemCategory] = useState("コーヒー"); 
  const { errorMsg, showError } = useErrorMessage();
  const [isSaving, setIsSaving] = useState(false);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  const displayCategories = ["コーヒー", "お菓子", "その他"];

  // 🔴 複数人が設定画面を開いた時のデータ先祖返りを防ぐための Transaction 処理（安全な merge 適用）
  const saveSettingsTransaction = async (action: "add" | "delete" | "toggle", payload: any) => {
    setIsSaving(true);
    try {
      await runTransaction(db, async (transaction) => {
        const docRef = doc(db, "menus", selectedDate);
        const docSnap = await transaction.get(docRef);
        const currentData = docSnap.exists() ? docSnap.data() : { items: [], useTicket: false };
        let newItems = currentData.items || [];
        let newUseTicket = currentData.useTicket !== undefined ? currentData.useTicket : false;

        if (action === "add") newItems.push(payload);
        if (action === "delete") newItems = newItems.filter((i: any) => i.id !== payload);
        if (action === "toggle") newUseTicket = payload;

        transaction.set(docRef, { items: newItems, useTicket: newUseTicket }, { merge: true }); // 🔴 merge: true 追加
      });
    } catch (error) {
      console.error("保存エラー:", error);
      showError("設定の保存に失敗しました。");
    } finally {
      setIsSaving(false);
    }
  };

  const handleAddItem = (e: React.FormEvent) => {
    e.preventDefault();
    const price = parseToNumber(newItemPrice);
    
    if (price <= 0) {
      showError("価格は1円以上に設定してください。");
      return;
    }
    if (!newItemName.trim() || !newItemCategory) return;
    
    const newItem: MenuItem = {
      id: Date.now().toString(),
      name: newItemName.trim(),
      price,
      category: newItemCategory,
    };
    
    saveSettingsTransaction("add", newItem);
    setNewItemName("");
    setNewItemPrice("");
  };

  const handleDeleteItem = async (id: string) => {
    await saveSettingsTransaction("delete", id);
    setConfirmDeleteId(null);
  };

  return (
    <div className="max-w-2xl mx-auto space-y-6 relative">
      {errorMsg && (
        <div className="absolute top-0 left-1/2 -translate-x-1/2 z-10 bg-red-50 text-red-600 text-sm font-bold px-4 py-2 rounded-lg border border-red-200 shadow-md animate-pulse">
          {errorMsg}
        </div>
      )}

      <div className="bg-white p-6 rounded-xl border border-neutral-200 shadow-sm flex items-center justify-between mt-2">
        <div>
          <h2 className="text-lg font-bold text-neutral-800">🎫 整理番号システム</h2>
          <p className="text-sm text-neutral-500 mt-1">レジで注文ごとに自由な整理番号を入力・発行できるようにします。</p>
        </div>
        <label className="relative inline-flex items-center cursor-pointer">
          <input type="checkbox" checked={useTicket} onChange={(e) => saveSettingsTransaction("toggle", e.target.checked)} className="sr-only peer" disabled={isSaving} />
          <div className="w-14 h-7 bg-neutral-200 peer-focus:outline-none rounded-full peer peer-checked:bg-emerald-500 peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-6 after:w-6 after:transition-all"></div>
        </label>
      </div>

      <div className="bg-white p-6 rounded-xl border border-neutral-200 shadow-sm">
        <h2 className="text-lg font-bold text-neutral-800 mb-4 pb-2 border-b border-neutral-100">📝 メニュー設定</h2>
        <form onSubmit={handleAddItem} className="flex flex-col sm:flex-row gap-3 mb-6 bg-neutral-50 p-4 rounded-lg border border-neutral-200">
          <select value={newItemCategory} onChange={(e) => setNewItemCategory(e.target.value)} className="w-full sm:w-1/3 p-2 border border-neutral-300 rounded focus:border-emerald-500 focus:outline-none text-sm bg-white font-medium">
            <option value="コーヒー">☕ コーヒー</option>
            <option value="お菓子">🍪 お菓子</option>
            <option value="その他">📦 その他</option>
          </select>
          <input type="text" placeholder="商品名" value={newItemName} onChange={(e) => setNewItemName(e.target.value)} className="flex-1 p-2 border border-neutral-300 rounded focus:border-emerald-500 focus:outline-none text-sm" />
          <div className="flex items-center bg-white border border-neutral-300 rounded focus-within:border-emerald-500 overflow-hidden">
            <span className="px-3 text-neutral-500 text-sm font-mono border-r border-neutral-300 bg-neutral-50">¥</span>
            <input type="number" placeholder="価格" value={newItemPrice} onChange={(e) => setNewItemPrice(e.target.value)} className="w-24 p-2 focus:outline-none text-sm font-mono" />
          </div>
          <button type="submit" disabled={isSaving || !newItemName.trim() || !newItemPrice.trim()} className="bg-emerald-600 hover:bg-emerald-700 text-white font-bold px-4 py-2 rounded text-sm transition-colors disabled:bg-neutral-300">追加</button>
        </form>

        <div className="space-y-4">
          <h3 className="font-bold text-neutral-600 text-sm">現在の登録メニュー ({menuItems.length}件)</h3>
          {menuItems.length === 0 ? (
            <p className="text-sm text-neutral-400 py-4 text-center border-2 border-dashed rounded-lg">メニューが登録されていません。</p>
          ) : (
            <div className="grid grid-cols-1 gap-2">
              {menuItems.map((item) => (
                <div key={item.id} className="flex justify-between items-center p-3 border border-neutral-200 rounded-lg bg-white">
                  <div className="flex items-center gap-3">
                    <span className="text-xs bg-neutral-100 px-2 py-1 rounded text-neutral-600 font-bold">{displayCategories.includes(item.category) ? item.category : "その他"}</span>
                    <span className="font-medium text-sm text-neutral-800">{item.name}</span>
                  </div>
                  <div className="flex items-center gap-4">
                    <span className="font-mono font-bold text-neutral-600 text-sm">{item.price}円</span>
                    {confirmDeleteId === item.id ? (
                      <div className="flex items-center gap-1 bg-red-50 p-1 rounded border border-red-100">
                        <button onClick={() => handleDeleteItem(item.id)} disabled={isSaving} className="bg-red-600 text-white font-bold text-[10px] px-2 py-1 rounded hover:bg-red-700 disabled:opacity-50">消去</button>
                        <button onClick={() => setConfirmDeleteId(null)} disabled={isSaving} className="bg-neutral-200 text-neutral-700 font-bold text-[10px] px-2 py-1 rounded hover:bg-neutral-300">戻る</button>
                      </div>
                    ) : (
                      <button onClick={() => setConfirmDeleteId(item.id)} className="text-red-500 hover:bg-red-50 p-1.5 rounded text-xs font-bold transition-colors">削除</button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}