"use client";

import { useState, useEffect, useMemo, useRef } from "react";
import dynamic from "next/dynamic";
import { collection, query, where, orderBy, onSnapshot, doc } from "firebase/firestore";
import { db, ensureSignedIn } from "../lib/firebase";
import { Mode, MenuItem, RawMenuItem, Order, CatDef, DEFAULT_CATEGORIES } from "../lib/types";
import { parseToNumber } from "../lib/utils";
import { ToastProvider, useToast } from "../lib/toast";
import { playOrderChime } from "../lib/sound";
import { InfoTip } from "../lib/info";
import CashierView from "./cashier-view";
import BaristaView from "./barista-view";
import SettingsView from "./settings-view";

// 軽量化: 重い分析ビューは必要になった時だけ読み込む（コード分割）
const Loading = () => <div className="text-center py-24 text-stone-400 text-sm tracking-wide">読み込み中…</div>;
const DashboardView = dynamic(() => import("./dashboard-view"), { loading: Loading, ssr: false });
const PeriodView = dynamic(() => import("./period-view"), { loading: Loading, ssr: false });

// ==========================================
// 新着オーダー通知
// Firestore スナップショットに「見たことのない注文」が現れたらトースト＋チャイムで知らせる。
// バリスタ画面を開いている端末にだけ通知する（レジ端末では自分の送信に反応してうるさいため）
// ==========================================
function OrderNotifier({ orders, isOrdersLoading, active, soundOn }: { orders: Order[]; isOrdersLoading: boolean; active: boolean; soundOn: boolean }) {
  const { showToast } = useToast();
  const seenIds = useRef<Set<string> | null>(null);

  useEffect(() => {
    // 読み込み中＝購読の切り替え中（営業日変更など）。既知IDを破棄して次のスナップショットで取り直す。
    // こうしないと日付切替時に「前の日のID集合 vs 新しい日の注文」の差分が全部新着扱いになる
    if (isOrdersLoading) {
      seenIds.current = null;
      return;
    }
    // 購読直後の最初のスナップショットは既存分の読み込みなので通知しない（IDを覚えるだけ）
    if (seenIds.current === null) {
      seenIds.current = new Set(orders.map((o) => o.id));
      return;
    }
    const fresh = orders.filter((o) => !seenIds.current!.has(o.id));
    fresh.forEach((o) => seenIds.current!.add(o.id));
    // 通知対象は製造が必要な注文だけ（レジで全品受け渡し済みの注文は除く）
    const newPending = fresh.filter((o) => o.status === "pending");
    if (newPending.length === 0 || !active) return;
    const itemCount = newPending.reduce((sum, o) => sum + (o.items?.reduce((s, i) => s + i.quantity, 0) ?? 0), 0);
    const label =
      newPending.length === 1
        ? `🔔 新しいオーダー${newPending[0].ticketNumber ? `（整理番号 ${newPending[0].ticketNumber}）` : ""} — ${itemCount}品`
        : `🔔 新しいオーダー ${newPending.length}件 — 計${itemCount}品`;
    showToast(label, "info");
    if (soundOn) playOrderChime();
  }, [orders, isOrdersLoading, active, soundOn, showToast]);

  return null;
}

const NAV: { mode: Mode; label: string; accent: string }[] = [
  { mode: "cashier", label: "📝 レジ入力", accent: "#ea580c" },
  { mode: "barista", label: "☕ バリスタ", accent: "#0891b2" },
  { mode: "dashboard", label: "📊 売上明細", accent: "#292524" },
  { mode: "period", label: "🗓️ 期間集計", accent: "#8a7390" },
  { mode: "settings", label: "⚙️ 設定", accent: "#a8823f" },
];

export default function App() {
  const [mode, setMode] = useState<Mode>("cashier");
  const [selectedDate, setSelectedDate] = useState(() => new Date().toISOString().split("T")[0]);

  const [orders, setOrders] = useState<Order[]>([]);
  const [menuItems, setMenuItems] = useState<MenuItem[]>([]);
  const [categories, setCategories] = useState<CatDef[]>(DEFAULT_CATEGORIES);
  const [useTicket, setUseTicket] = useState(false);
  const [showAvgTime, setShowAvgTime] = useState(false);

  const [isOrdersLoading, setIsOrdersLoading] = useState(true);
  const [isMenuLoading, setIsMenuLoading] = useState(true);

  // 整理番号は App 側で保持（タブを切り替えてもリセットされないように）
  const [ticketNumber, setTicketNumber] = useState("");
  const ticketInitialized = useRef(false);

  // 通知音のON/OFF（端末ごとに localStorage で記憶。SSRとの不一致を避けるため初期値はOFF→マウント後に復元）
  const [soundOn, setSoundOn] = useState(false);
  useEffect(() => {
    setSoundOn(localStorage.getItem("cooffambers-notify-sound") !== "off");
  }, []);
  const toggleSound = () => {
    const next = !soundOn;
    setSoundOn(next);
    localStorage.setItem("cooffambers-notify-sound", next ? "on" : "off");
    if (next) playOrderChime(); // ユーザー操作の時点で音声をアンロックしつつ試聴を兼ねる
  };

  // 認証（匿名サインイン）が済んでから Firestore を購読する。
  // ルールが request.auth != null の場合、サインイン前の購読は権限エラーになるため
  const [authReady, setAuthReady] = useState(false);
  useEffect(() => ensureSignedIn(() => setAuthReady(true)), []);

  useEffect(() => {
    if (!authReady) return;
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
  }, [selectedDate, authReady]);

  useEffect(() => {
    if (!authReady) return;
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
          ...(item.hotPrice != null && { hotPrice: parseToNumber(item.hotPrice) }),
          ...(item.icePrice != null && { icePrice: parseToNumber(item.icePrice) }),
          ...(item.stock != null && { stock: parseToNumber(item.stock) }),
        }));
        setMenuItems(safeItems);
        const rawCats = docSnap.data().categories as CatDef[] | undefined;
        setCategories(
          Array.isArray(rawCats) && rawCats.length
            ? rawCats.map((c) => ({ id: String(c.id), name: String(c.name), hasTemp: Boolean(c.hasTemp) }))
            : DEFAULT_CATEGORIES
        );
        setUseTicket(docSnap.data().useTicket || false);
        setShowAvgTime(docSnap.data().showAvgTime || false);
      } else {
        setMenuItems([]);
        setCategories(DEFAULT_CATEGORIES);
        setUseTicket(false);
        setShowAvgTime(false);
      }
      setIsMenuLoading(false);
    });
    return () => unsubscribe();
  }, [selectedDate, authReady]);

  // 整理番号の自動採番: 既存注文の最大番号 + 1（無ければ 1）
  const suggestedTicket = useMemo(() => {
    let max = 0;
    orders.forEach((o) => {
      if (o.status === "cancelled" || !o.ticketNumber) return;
      const n = parseToNumber(o.ticketNumber);
      if (n > max) max = n;
    });
    return max + 1;
  }, [orders]);

  // 営業日を切り替えたら採番をリセット
  useEffect(() => {
    ticketInitialized.current = false;
    setTicketNumber("");
  }, [selectedDate]);

  // 注文読み込み後に初期の整理番号をセット（営業日ごとに1回だけ）
  useEffect(() => {
    if (useTicket && !isOrdersLoading && !ticketInitialized.current) {
      setTicketNumber(String(suggestedTicket));
      ticketInitialized.current = true;
    }
  }, [useTicket, isOrdersLoading, suggestedTicket]);

  const pendingOrdersCount = useMemo(() => orders.filter((o) => o.status === "pending").length, [orders]);
  const activeAccent = NAV.find((n) => n.mode === mode)?.accent ?? "#8a5a3b";

  return (
    <ToastProvider>
      <OrderNotifier key={selectedDate} orders={orders} isOrdersLoading={isOrdersLoading} active={mode === "barista"} soundOn={soundOn} />
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
          {!authReady && <Loading />}
          {authReady && mode === "cashier" && (
            <CashierView
              selectedDate={selectedDate}
              menuItems={menuItems}
              categories={categories}
              isMenuLoading={isMenuLoading}
              useTicket={useTicket}
              showAvgTime={showAvgTime}
              orders={orders}
              ticketNumber={ticketNumber}
              setTicketNumber={setTicketNumber}
            />
          )}
          {authReady && mode === "barista" && (
            <BaristaView orders={orders} isOrdersLoading={isOrdersLoading} menuItems={menuItems} categories={categories} selectedDate={selectedDate} soundOn={soundOn} onToggleSound={toggleSound} />
          )}
          {authReady && mode === "dashboard" && <DashboardView orders={orders} selectedDate={selectedDate} menuItems={menuItems} categories={categories} />}
          {authReady && mode === "period" && <PeriodView />}
          {authReady && mode === "settings" && <SettingsView selectedDate={selectedDate} menuItems={menuItems} categories={categories} useTicket={useTicket} showAvgTime={showAvgTime} />}
        </main>
      </div>
    </ToastProvider>
  );
}
