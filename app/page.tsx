"use client";

import { useState, useEffect, useMemo } from "react";
import dynamic from "next/dynamic";
import { collection, query, where, orderBy, onSnapshot, doc } from "firebase/firestore";
import { db } from "../lib/firebase";
import { Mode, MenuItem, RawMenuItem, Order } from "../lib/types";
import { parseToNumber } from "../lib/utils";
import { ToastProvider } from "../lib/toast";
import { InfoTip } from "../lib/info";
import CashierView from "./cashier-view";
import BaristaView from "./barista-view";
import SettingsView from "./settings-view";

// 🔴 軽量化: 重い分析ビューは必要になった時だけ読み込む（コード分割）
const Loading = () => <div className="text-center py-20 text-neutral-500 font-bold">読み込み中...</div>;
const DashboardView = dynamic(() => import("./dashboard-view"), { loading: Loading, ssr: false });
const PeriodView = dynamic(() => import("./period-view"), { loading: Loading, ssr: false });

const NAV: { mode: Mode; label: (n: number) => string; active: string; inactive: string }[] = [
  { mode: "cashier", label: () => "📝 レジ入力", active: "border-orange-600 text-orange-600 font-bold", inactive: "border-transparent text-neutral-500 hover:text-neutral-800" },
  { mode: "barista", label: (n) => `☕ バリスタ (${n})`, active: "border-cyan-600 text-cyan-600 font-bold", inactive: "border-transparent text-neutral-500 hover:text-neutral-800" },
  { mode: "dashboard", label: () => "📊 売上明細", active: "border-stone-800 text-stone-800 font-bold", inactive: "border-transparent text-neutral-500 hover:text-neutral-800" },
  { mode: "period", label: () => "🗓️ 期間集計", active: "border-indigo-600 text-indigo-600 font-bold", inactive: "border-transparent text-neutral-500 hover:text-neutral-800" },
  { mode: "settings", label: () => "⚙️ 設定", active: "border-emerald-600 text-emerald-600 font-bold", inactive: "border-transparent text-neutral-500 hover:text-neutral-800" },
];

export default function App() {
  const [mode, setMode] = useState<Mode>("cashier");
  const [selectedDate, setSelectedDate] = useState(() => new Date().toISOString().split("T")[0]);

  const [orders, setOrders] = useState<Order[]>([]);
  const [menuItems, setMenuItems] = useState<MenuItem[]>([]);
  const [useTicket, setUseTicket] = useState(false);

  const [isOrdersLoading, setIsOrdersLoading] = useState(true);
  const [isMenuLoading, setIsMenuLoading] = useState(true);

  useEffect(() => {
    setIsOrdersLoading(true);
    const q = query(collection(db, "orders"), where("date", "==", selectedDate), orderBy("createdAt", "asc"));
    const unsubscribe = onSnapshot(
      q,
      (snapshot) => {
        const data: Order[] = [];
        snapshot.forEach((d) => data.push({ id: d.id, ...d.data() } as Order));
        setOrders(data);
        setIsOrdersLoading(false);
      },
      (error) => {
        console.error("Firestore Subscribe Error:", error);
        setIsOrdersLoading(false);
      }
    );
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
          soldOut: Boolean(item.soldOut),
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

  const pendingOrdersCount = useMemo(() => orders.filter((o) => o.status === "pending").length, [orders]);

  return (
    <ToastProvider>
      <div className="min-h-screen bg-neutral-50 text-neutral-800 font-sans antialiased">
        <nav className="bg-white/90 backdrop-blur border-b border-neutral-200 sticky top-0 z-50 shadow-sm">
          <div className="max-w-6xl mx-auto flex flex-col sm:flex-row justify-between items-center px-4">
            <div className="py-3 sm:py-4 font-bold text-lg tracking-wider text-neutral-700 w-full sm:w-auto text-center sm:text-left flex items-center gap-2 justify-center sm:justify-start">
              <span className="text-orange-600">☕</span> Cooffambers POS
            </div>
            <div className="flex space-x-1 overflow-x-auto w-full sm:w-auto pb-1 sm:pb-0">
              {NAV.map(({ mode: m, label, active, inactive }) => {
                const isActive = mode === m;
                return (
                  <button
                    key={m}
                    onClick={() => setMode(m)}
                    className={`whitespace-nowrap px-3 sm:px-4 py-3 sm:py-4 text-sm font-medium border-b-2 transition-colors ${isActive ? active : inactive}`}
                  >
                    {label(pendingOrdersCount)}
                  </button>
                );
              })}
            </div>
          </div>
        </nav>

        <div className="bg-white border-b border-neutral-200 px-4 py-2 text-right">
          <div className="max-w-6xl mx-auto flex items-center justify-end space-x-2 text-sm text-neutral-500">
            <span className="flex items-center gap-1">
              📅 対象の営業日:
              <InfoTip text="操作する日付を選びます。メニュー・注文・売上はすべてこの営業日ごとに保存・表示されます。別の日に切り替えると、その日のデータに変わります。" align="right" />
            </span>
            <input
              type="date"
              value={selectedDate}
              onChange={(e) => setSelectedDate(e.target.value)}
              className="border border-neutral-300 rounded px-2 py-1 text-neutral-800 bg-neutral-50 font-medium focus:outline-none focus:border-orange-500"
            />
          </div>
        </div>

        <main className="max-w-6xl mx-auto p-4 md:p-6">
          {mode === "cashier" && (
            <CashierView
              selectedDate={selectedDate}
              menuItems={menuItems}
              isMenuLoading={isMenuLoading}
              useTicket={useTicket}
              orders={orders}
              isOrdersLoading={isOrdersLoading}
            />
          )}
          {mode === "barista" && <BaristaView orders={orders} isOrdersLoading={isOrdersLoading} menuItems={menuItems} selectedDate={selectedDate} />}
          {mode === "dashboard" && <DashboardView orders={orders} selectedDate={selectedDate} menuItems={menuItems} />}
          {mode === "period" && <PeriodView />}
          {mode === "settings" && <SettingsView selectedDate={selectedDate} menuItems={menuItems} useTicket={useTicket} />}
        </main>
      </div>
    </ToastProvider>
  );
}
