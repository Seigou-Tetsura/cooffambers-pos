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

// 軽量化: 重い分析ビューは必要になった時だけ読み込む（コード分割）
const Loading = () => <div className="text-center py-24 text-stone-400 text-sm tracking-wide">読み込み中…</div>;
const DashboardView = dynamic(() => import("./dashboard-view"), { loading: Loading, ssr: false });
const PeriodView = dynamic(() => import("./period-view"), { loading: Loading, ssr: false });

<<<<<<< HEAD
// 各画面のアイデンティティカラー（くすみ系）— 視線誘導のための色分け
const NAV: { mode: Mode; label: string; accent: string }[] = [
  { mode: "cashier", label: "レジ", accent: "#8a5a3b" },
  { mode: "barista", label: "バリスタ", accent: "#688a74" },
  { mode: "dashboard", label: "売上明細", accent: "#6b7e9d" },
  { mode: "period", label: "期間集計", accent: "#8a7390" },
  { mode: "settings", label: "設定", accent: "#a8823f" },
=======
const NAV: { mode: Mode; label: (n: number) => string; active: string; inactive: string }[] = [
  { mode: "cashier", label: () => "📝 レジ入力", active: "border-orange-600 text-orange-600 font-bold", inactive: "border-transparent text-neutral-500 hover:text-neutral-800" },
  { mode: "barista", label: (n) => `☕ バリスタ (${n})`, active: "border-cyan-600 text-cyan-600 font-bold", inactive: "border-transparent text-neutral-500 hover:text-neutral-800" },
  { mode: "dashboard", label: () => "📊 売上明細", active: "border-stone-800 text-stone-800 font-bold", inactive: "border-transparent text-neutral-500 hover:text-neutral-800" },
  { mode: "period", label: () => "🗓️ 期間集計", active: "border-indigo-600 text-indigo-600 font-bold", inactive: "border-transparent text-neutral-500 hover:text-neutral-800" },
  { mode: "settings", label: () => "⚙️ 設定", active: "border-emerald-600 text-emerald-600 font-bold", inactive: "border-transparent text-neutral-500 hover:text-neutral-800" },
>>>>>>> 7b38f7592aeb6b3cc07b2f5eb9f618554d85acba
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
  const activeAccent = NAV.find((n) => n.mode === mode)?.accent ?? "#8a5a3b";

  return (
    <ToastProvider>
      <div className="min-h-screen bg-[#f3efe7] text-stone-800">
        <header className="bg-[#f3efe7]/85 backdrop-blur-md border-b border-stone-200/70 sticky top-0 z-50">
          <div className="max-w-6xl mx-auto px-5 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-1.5">
            <div className="pt-4 sm:py-4 flex items-center gap-3 justify-center sm:justify-start">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src="/logo.png"
                alt="Cooffambers"
                className="w-11 h-11 rounded-full object-cover ring-1 ring-stone-200 bg-white shrink-0"
                onError={(e) => {
                  e.currentTarget.style.display = "none";
                }}
              />
              <div className="flex flex-col leading-none">
                <span className="text-[18px] font-semibold tracking-tight text-stone-900">Cooffambers</span>
                <span className="text-[9px] font-semibold uppercase tracking-[0.34em] text-stone-400 mt-1">Point of Sale</span>
              </div>
            </div>
            <nav className="flex justify-center sm:justify-end -mb-px overflow-x-auto">
              {NAV.map(({ mode: m, label, accent }) => {
                const isActive = mode === m;
                const showBadge = m === "barista" && pendingOrdersCount > 0;
                return (
                  <button
                    key={m}
                    onClick={() => setMode(m)}
                    style={isActive ? { color: accent, borderColor: accent } : undefined}
                    className={`relative whitespace-nowrap px-4 py-3 sm:py-4 text-[13px] tracking-wide border-b-2 transition-colors ${
                      isActive ? "font-semibold" : "border-transparent text-stone-400 hover:text-stone-700 font-medium"
                    }`}
                  >
                    {label}
                    {showBadge && (
                      <span
                        style={{ backgroundColor: accent }}
                        className="ml-1.5 inline-flex items-center justify-center min-w-[18px] h-[18px] px-1 rounded-full text-white text-[10px] font-bold align-middle tnum"
                      >
                        {pendingOrdersCount}
                      </span>
                    )}
                  </button>
                );
              })}
            </nav>
          </div>
        </header>

        <div className="border-b border-stone-200/70">
          <div className="max-w-6xl mx-auto px-5 py-2.5 flex items-center justify-end gap-2.5 text-sm">
            <span className="text-[10px] font-semibold uppercase tracking-[0.12em] text-stone-400 flex items-center gap-1">
              営業日
              <InfoTip text="操作する日付を選びます。メニュー・注文・売上はすべてこの営業日ごとに保存・表示されます。別の日に切り替えると、その日のデータに変わります。" align="right" />
            </span>
            <input
              type="date"
              value={selectedDate}
              onChange={(e) => setSelectedDate(e.target.value)}
              style={{ outlineColor: activeAccent }}
              className="border border-stone-300 rounded-md px-2.5 py-1 text-stone-800 bg-white/70 font-medium tnum focus:outline-none focus:border-stone-400"
            />
          </div>
        </div>

        <main className="max-w-6xl mx-auto px-4 sm:px-5 py-6 sm:py-8">
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
