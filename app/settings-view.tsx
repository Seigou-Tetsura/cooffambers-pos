"use client";

import { useState } from "react";
import { MenuItem, CATEGORIES } from "../lib/types";
import { parseToNumber } from "../lib/utils";
import { mutateMenu } from "../lib/menu";
import { useToast } from "../lib/toast";
import { InfoTip } from "../lib/info";

// ==========================================
// ⚙️ メニュー設定（SettingsView）
// ==========================================
export default function SettingsView({
  selectedDate,
  menuItems,
  useTicket,
}: {
  selectedDate: string;
  menuItems: MenuItem[];
  useTicket: boolean;
}) {
  const [newItemName, setNewItemName] = useState("");
  const [newItemPrice, setNewItemPrice] = useState<string>("");
  const [newItemCategory, setNewItemCategory] = useState<string>("コーヒー");
  const { showError } = useToast();
  const [isSaving, setIsSaving] = useState(false);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  const run = async (fn: () => Promise<void>) => {
    setIsSaving(true);
    try {
      await fn();
    } catch (e) {
      console.error("保存エラー:", e);
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

    run(() =>
      mutateMenu(selectedDate, {
        type: "add",
        item: { id: Date.now().toString(), name: newItemName.trim(), price, category: newItemCategory, soldOut: false },
      })
    );
    setNewItemName("");
    setNewItemPrice("");
  };

  const handleDeleteItem = (id: string) => {
    run(() => mutateMenu(selectedDate, { type: "delete", id }));
    setConfirmDeleteId(null);
  };

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      <div className="bg-white p-6 rounded-2xl border border-neutral-200 shadow-sm flex items-center justify-between">
        <div>
          <h2 className="text-lg font-bold text-neutral-800 flex items-center gap-1.5">
            🎫 整理番号システム
            <InfoTip text="オンにすると、レジで注文ごとに整理番号を発行できます。番号は自動で1ずつ増え、手入力でも変更できます。" align="left" />
          </h2>
          <p className="text-sm text-neutral-500 mt-1">レジで注文ごとに整理番号を発行できるようにします（自動で1から採番）。</p>
        </div>
        <label className="relative inline-flex items-center cursor-pointer">
          <input
            type="checkbox"
            checked={useTicket}
            onChange={(e) => run(() => mutateMenu(selectedDate, { type: "toggleTicket", value: e.target.checked }))}
            className="sr-only peer"
            disabled={isSaving}
          />
          <div className="w-14 h-7 bg-neutral-200 peer-focus:outline-none rounded-full peer peer-checked:bg-emerald-500 peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-6 after:w-6 after:transition-all"></div>
        </label>
      </div>

      <div className="bg-white p-6 rounded-2xl border border-neutral-200 shadow-sm">
        <h2 className="text-lg font-bold text-neutral-800 mb-4 pb-2 border-b border-neutral-100 flex items-center gap-1.5">
          📝 メニュー設定
          <InfoTip text="この営業日に販売する商品を登録します。カテゴリ・商品名・価格を入れて「追加」。各商品は「販売中／売切中」を切り替えたり削除できます。メニューは営業日ごとに保存されます。" align="left" />
        </h2>
        <form onSubmit={handleAddItem} className="flex flex-col sm:flex-row gap-3 mb-6 bg-neutral-50 p-4 rounded-lg border border-neutral-200">
          <select
            value={newItemCategory}
            onChange={(e) => setNewItemCategory(e.target.value)}
            className="w-full sm:w-1/3 p-2 border border-neutral-300 rounded focus:border-emerald-500 focus:outline-none text-sm bg-white font-medium"
          >
            <option value="コーヒー">☕ コーヒー</option>
            <option value="お菓子">🍪 お菓子</option>
            <option value="その他">📦 その他</option>
          </select>
          <input
            type="text"
            placeholder="商品名"
            value={newItemName}
            onChange={(e) => setNewItemName(e.target.value)}
            className="flex-1 p-2 border border-neutral-300 rounded focus:border-emerald-500 focus:outline-none text-sm"
          />
          <div className="flex items-center bg-white border border-neutral-300 rounded focus-within:border-emerald-500 overflow-hidden">
            <span className="px-3 text-neutral-500 text-sm font-mono border-r border-neutral-300 bg-neutral-50">¥</span>
            <input
              type="number"
              placeholder="価格"
              value={newItemPrice}
              onChange={(e) => setNewItemPrice(e.target.value)}
              className="w-24 p-2 focus:outline-none text-sm font-mono"
            />
          </div>
          <button
            type="submit"
            disabled={isSaving || !newItemName.trim() || !newItemPrice.trim()}
            className="bg-emerald-600 hover:bg-emerald-700 text-white font-bold px-4 py-2 rounded text-sm transition-colors disabled:bg-neutral-300"
          >
            追加
          </button>
        </form>

        <div className="space-y-4">
          <h3 className="font-bold text-neutral-600 text-sm">現在の登録メニュー ({menuItems.length}件)</h3>
          {menuItems.length === 0 ? (
            <p className="text-sm text-neutral-400 py-4 text-center border-2 border-dashed rounded-lg">メニューが登録されていません。</p>
          ) : (
            <div className="grid grid-cols-1 gap-2">
              {menuItems.map((item) => (
                <div key={item.id} className={`flex justify-between items-center p-3 border rounded-lg ${item.soldOut ? "border-red-200 bg-red-50" : "border-neutral-200 bg-white"}`}>
                  <div className="flex items-center gap-3">
                    <span className="text-xs bg-neutral-100 px-2 py-1 rounded text-neutral-600 font-bold">
                      {(CATEGORIES as string[]).includes(item.category) ? item.category : "その他"}
                    </span>
                    <span className={`font-medium text-sm ${item.soldOut ? "text-red-400 line-through" : "text-neutral-800"}`}>{item.name}</span>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="font-mono font-bold text-neutral-600 text-sm">{item.price}円</span>
                    <button
                      onClick={() => run(() => mutateMenu(selectedDate, { type: "toggleSoldOut", id: item.id, value: !item.soldOut }))}
                      disabled={isSaving}
                      className={`text-[11px] font-black px-2.5 py-1 rounded-full transition-colors disabled:opacity-50 ${
                        item.soldOut ? "bg-red-500 text-white hover:bg-red-600" : "bg-emerald-100 text-emerald-700 hover:bg-emerald-200"
                      }`}
                    >
                      {item.soldOut ? "売切中" : "販売中"}
                    </button>
                    {confirmDeleteId === item.id ? (
                      <div className="flex items-center gap-1 bg-red-50 p-1 rounded border border-red-100">
                        <button onClick={() => handleDeleteItem(item.id)} disabled={isSaving} className="bg-red-600 text-white font-bold text-[10px] px-2 py-1 rounded hover:bg-red-700 disabled:opacity-50">
                          消去
                        </button>
                        <button onClick={() => setConfirmDeleteId(null)} disabled={isSaving} className="bg-neutral-200 text-neutral-700 font-bold text-[10px] px-2 py-1 rounded hover:bg-neutral-300">
                          戻る
                        </button>
                      </div>
                    ) : (
                      <button onClick={() => setConfirmDeleteId(item.id)} className="text-red-500 hover:bg-red-50 p-1.5 rounded text-xs font-bold transition-colors">
                        削除
                      </button>
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
