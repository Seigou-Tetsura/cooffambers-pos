"use client";

import { useState } from "react";
import { doc, updateDoc, serverTimestamp } from "firebase/firestore";
import { db } from "../lib/firebase";
import { Order, CartItem, MenuItem, CATEGORIES } from "../lib/types";
import { useToast } from "../lib/toast";

// ==========================================
// ✏️ 注文編集モーダル
// 送信済みの注文の数量修正・商品削除・商品追加に対応
// ==========================================
export default function OrderEditModal({
  order,
  menuItems,
  onClose,
}: {
  order: Order;
  menuItems: MenuItem[];
  onClose: () => void;
}) {
  const { showError, showToast } = useToast();
  const [items, setItems] = useState<CartItem[]>(() => order.items.map((i) => ({ ...i })));
  const [selectedTemp, setSelectedTemp] = useState<"Hot" | "Ice">("Hot");
  const [isSaving, setIsSaving] = useState(false);

  const total = items.reduce((sum, i) => sum + i.price * i.quantity, 0);

  const changeQty = (id: string, delta: number) => {
    setItems((prev) => prev.map((i) => (i.id === id ? { ...i, quantity: i.quantity + delta } : i)).filter((i) => i.quantity > 0));
  };

  const addFromMenu = (item: MenuItem) => {
    const isCoffee = item.category === "コーヒー";
    const cartItemId = `${item.id}-${isCoffee ? selectedTemp : "none"}`;
    setItems((prev) => {
      const idx = prev.findIndex((i) => i.id === cartItemId);
      if (idx > -1) {
        const next = [...prev];
        next[idx] = { ...next[idx], quantity: next[idx].quantity + 1 };
        return next;
      }
      return [
        ...prev,
        { id: cartItemId, name: item.name, price: item.price, category: item.category, quantity: 1, ...(isCoffee && { temperature: selectedTemp }) },
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
    <div className="fixed inset-0 z-[90] flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg max-h-[88vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
        <div className="p-5 border-b border-neutral-100 flex justify-between items-center">
          <div>
            <h3 className="font-bold text-neutral-800">✏️ 注文の編集</h3>
            <p className="text-xs text-neutral-400 mt-0.5">{order.ticketNumber ? `🎫 整理番号 ${order.ticketNumber}` : "整理番号なし"}</p>
          </div>
          <button onClick={onClose} className="text-neutral-400 hover:text-neutral-700 text-2xl leading-none">×</button>
        </div>

        <div className="p-5 overflow-y-auto space-y-4">
          {/* 現在の明細 */}
          <div className="space-y-2">
            {items.length === 0 ? (
              <p className="text-sm text-neutral-400 text-center py-4">商品がありません。下から追加してください。</p>
            ) : (
              items.map((item) => (
                <div key={item.id} className="flex justify-between items-center border border-neutral-100 rounded-xl p-3">
                  <div className="flex items-center gap-1.5">
                    {item.temperature && (
                      <span className={`text-[10px] px-1.5 py-0.5 rounded font-black ${item.temperature === "Hot" ? "bg-red-100 text-red-600" : "bg-blue-100 text-blue-600"}`}>
                        {item.temperature}
                      </span>
                    )}
                    <span className="font-bold text-sm text-neutral-800">{item.name}</span>
                    <span className="text-xs text-neutral-400 font-mono ml-1">{item.price}円</span>
                  </div>
                  <div className="flex items-center space-x-2 bg-neutral-50 p-1 rounded-lg border border-neutral-200">
                    <button onClick={() => changeQty(item.id, -1)} className="w-7 h-7 bg-white border border-neutral-200 rounded font-bold hover:bg-neutral-100">-</button>
                    <span className="font-mono w-5 text-center font-bold text-neutral-700">{item.quantity}</span>
                    <button onClick={() => changeQty(item.id, 1)} className="w-7 h-7 bg-white border border-neutral-200 rounded font-bold hover:bg-neutral-100">+</button>
                  </div>
                </div>
              ))
            )}
          </div>

          {/* 商品追加 */}
          <div className="bg-neutral-50 rounded-xl border border-neutral-200 p-4">
            <div className="flex justify-between items-center mb-3">
              <h4 className="text-sm font-bold text-neutral-600">商品を追加</h4>
              <div className="flex bg-white border border-neutral-200 rounded-lg p-0.5 text-xs font-bold">
                <button onClick={() => setSelectedTemp("Hot")} className={`px-3 py-1 rounded ${selectedTemp === "Hot" ? "bg-red-100 text-red-600" : "text-neutral-400"}`}>HOT</button>
                <button onClick={() => setSelectedTemp("Ice")} className={`px-3 py-1 rounded ${selectedTemp === "Ice" ? "bg-blue-100 text-blue-600" : "text-neutral-400"}`}>ICE</button>
              </div>
            </div>
            {menuItems.length === 0 ? (
              <p className="text-xs text-neutral-400">この営業日のメニューがありません。</p>
            ) : (
              <div className="space-y-3">
                {CATEGORIES.map((cat) => {
                  const list = menuItems.filter((m) => m.category === cat);
                  if (list.length === 0) return null;
                  return (
                    <div key={cat}>
                      <div className="text-[11px] text-neutral-400 font-bold mb-1">{cat}</div>
                      <div className="flex flex-wrap gap-2">
                        {list.map((m) => (
                          <button
                            key={m.id}
                            onClick={() => addFromMenu(m)}
                            className="text-xs font-bold bg-white border border-neutral-300 rounded-lg px-3 py-1.5 hover:bg-orange-50 hover:border-orange-300 transition-colors active:scale-95"
                          >
                            + {m.name}
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

        <div className="p-5 border-t border-neutral-100 flex items-center justify-between gap-4">
          <div className="text-sm font-bold text-neutral-500">
            合計 <span className="text-xl font-black font-mono text-neutral-800 ml-1">¥{total.toLocaleString()}</span>
          </div>
          <div className="flex gap-2">
            <button onClick={onClose} className="px-4 py-2.5 rounded-xl border border-neutral-300 text-neutral-600 font-bold text-sm hover:bg-neutral-50">キャンセル</button>
            <button onClick={handleSave} disabled={isSaving} className="px-5 py-2.5 rounded-xl bg-orange-600 hover:bg-orange-700 text-white font-bold text-sm shadow-sm active:scale-95 disabled:opacity-50">
              {isSaving ? "保存中..." : "変更を保存"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
