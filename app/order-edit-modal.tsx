"use client";

import { useState, useMemo } from "react";
import { doc, updateDoc, serverTimestamp } from "firebase/firestore";
import { db } from "../lib/firebase";
import { Order, CartItem, MenuItem, CatDef } from "../lib/types";
import { useToast } from "../lib/toast";

// ==========================================
// 注文編集モーダル
// 送信済みの注文の数量修正・商品削除・商品追加に対応
// ==========================================
export default function OrderEditModal({
  order,
  menuItems,
  categories,
  onClose,
}: {
  order: Order;
  menuItems: MenuItem[];
  categories: CatDef[];
  onClose: () => void;
}) {
  const { showError, showToast } = useToast();
  const [items, setItems] = useState<CartItem[]>(() => order.items.map((i) => ({ ...i })));
  const [selectedTemp, setSelectedTemp] = useState<"Hot" | "Ice">("Hot");
  const [isSaving, setIsSaving] = useState(false);

  const tempCategoryNames = useMemo(() => new Set(categories.filter((c) => c.hasTemp).map((c) => c.name)), [categories]);
  const total = items.reduce((sum, i) => sum + i.price * i.quantity, 0);

  const changeQty = (id: string, delta: number) => {
    setItems((prev) => prev.map((i) => (i.id === id ? { ...i, quantity: i.quantity + delta } : i)).filter((i) => i.quantity > 0));
  };

  const addFromMenu = (item: MenuItem) => {
    const isTemp = tempCategoryNames.has(item.category);
    const cartItemId = `${item.id}-${isTemp ? selectedTemp : "none"}`;
    setItems((prev) => {
      const idx = prev.findIndex((i) => i.id === cartItemId);
      if (idx > -1) {
        const next = [...prev];
        next[idx] = { ...next[idx], quantity: next[idx].quantity + 1 };
        return next;
      }
      return [
        ...prev,
        { id: cartItemId, name: item.name, price: item.price, category: item.category, quantity: 1, ...(isTemp && { temperature: selectedTemp }) },
      ];
    });
  };

  const handleSave = async () => {
    if (isSaving) return;
    if (items.length === 0) {
      showError("商品が空です。取消する場合は明細の「取消」を使ってください。");
      return;
    }
    setIsSaving(true);
    try {
      await updateDoc(doc(db, "orders", order.id), { items, totalPrice: total, updatedAt: serverTimestamp() });
      showToast("注文を更新しました");
      onClose();
    } catch (e) {
      console.error(e);
      showError("注文の更新に失敗しました。");
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[90] flex items-center justify-center p-4 bg-stone-900/30 backdrop-blur-sm" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg max-h-[88vh] flex flex-col border border-stone-200" onClick={(e) => e.stopPropagation()}>
        <div className="px-5 py-4 border-b border-stone-200 flex justify-between items-center">
          <div>
            <h3 className="text-sm font-semibold text-stone-800">注文の編集</h3>
            <p className="text-xs text-stone-400 mt-0.5">{order.ticketNumber ? `整理番号 ${order.ticketNumber}` : "整理番号なし"}</p>
          </div>
          <button onClick={onClose} className="text-stone-400 hover:text-stone-700 w-7 h-7 flex items-center justify-center rounded-md hover:bg-stone-100 text-xl leading-none">×</button>
        </div>

        <div className="px-5 py-4 overflow-y-auto space-y-4">
          {/* 現在の明細 */}
          <div className="space-y-2">
            {items.length === 0 ? (
              <p className="text-sm text-stone-400 text-center py-4">商品がありません。下から追加してください。</p>
            ) : (
              items.map((item) => (
                <div key={item.id} className="flex justify-between items-center border border-stone-200 rounded-lg px-3 py-2.5">
                  <div className="flex items-center gap-1.5 min-w-0">
                    {item.temperature && (
                      <span className={`text-[9px] px-1.5 py-0.5 rounded font-bold tracking-wide ${item.temperature === "Hot" ? "bg-red-100 text-red-700" : "bg-blue-100 text-blue-700"}`}>
                        {item.temperature === "Hot" ? "HOT" : "ICE"}
                      </span>
                    )}
                    <span className="text-sm font-medium text-stone-800 truncate">{item.name}</span>
                    <span className="text-xs text-stone-400 font-mono tnum ml-1 shrink-0">¥{item.price.toLocaleString()}</span>
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    <button onClick={() => changeQty(item.id, -1)} className="w-7 h-7 rounded-md border border-stone-200 text-stone-500 hover:bg-stone-50">−</button>
                    <span className="font-mono w-6 text-center text-sm font-semibold text-stone-800 tnum">{item.quantity}</span>
                    <button onClick={() => changeQty(item.id, 1)} className="w-7 h-7 rounded-md border border-stone-200 text-stone-500 hover:bg-stone-50">+</button>
                  </div>
                </div>
              ))
            )}
          </div>

          {/* 商品追加 */}
          <div className="bg-stone-50 rounded-lg border border-stone-200 p-4">
            <div className="flex justify-between items-center mb-3">
              <h4 className="text-[11px] font-semibold uppercase tracking-[0.12em] text-stone-400">商品を追加</h4>
              <div className="flex bg-white border border-stone-200 rounded-md p-0.5 text-xs font-bold">
                <button onClick={() => setSelectedTemp("Hot")} className={`px-3 py-1 rounded ${selectedTemp === "Hot" ? "bg-red-100 text-red-700" : "text-stone-400"}`}>HOT</button>
                <button onClick={() => setSelectedTemp("Ice")} className={`px-3 py-1 rounded ${selectedTemp === "Ice" ? "bg-blue-100 text-blue-700" : "text-stone-400"}`}>ICE</button>
              </div>
            </div>
            {menuItems.length === 0 ? (
              <p className="text-xs text-stone-400">この営業日のメニューがありません。</p>
            ) : (
              <div className="space-y-3">
                {categories.map((cat) => {
                  const list = menuItems.filter((m) => m.category === cat.name);
                  if (list.length === 0) return null;
                  return (
                    <div key={cat.id}>
                      <div className="text-[10px] uppercase tracking-wider text-stone-400 font-semibold mb-1.5">{cat.name}</div>
                      <div className="flex flex-wrap gap-1.5">
                        {list.map((m) => (
                          <button
                            key={m.id}
                            onClick={() => addFromMenu(m)}
                            className="text-xs font-medium bg-white border border-stone-300 rounded-md px-3 py-1.5 hover:border-[#6b7e9d]/50 hover:bg-[#6b7e9d]/[0.04] transition-colors active:scale-[0.98]"
                          >
                            {m.name}
                          </button>
                        ))}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        <div className="px-5 py-4 border-t border-stone-200 flex items-center justify-between gap-4">
          <div className="text-sm text-stone-500">
            合計 <span className="text-xl font-semibold tnum text-stone-900 ml-1">¥{total.toLocaleString()}</span>
          </div>
          <div className="flex gap-2">
            <button onClick={onClose} className="px-4 py-2.5 rounded-lg border border-stone-300 text-stone-600 font-medium text-sm hover:bg-stone-50">キャンセル</button>
            <button onClick={handleSave} disabled={isSaving} className="px-5 py-2.5 rounded-lg bg-stone-900 hover:bg-stone-800 text-white font-medium text-sm transition-colors active:scale-[0.99] disabled:opacity-50">
              {isSaving ? "保存中…" : "変更を保存"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
