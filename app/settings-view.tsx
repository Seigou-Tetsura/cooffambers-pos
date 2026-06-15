"use client";

import { useState } from "react";
import { MenuItem, CATEGORIES } from "../lib/types";
import { parseToNumber } from "../lib/utils";
import { mutateMenu } from "../lib/menu";
import { useToast } from "../lib/toast";
import { InfoTip } from "../lib/info";

// ==========================================
// メニュー設定（SettingsView）
// ==========================================
export default function SettingsView({
  selectedDate,
  menuItems,
  useTicket,
  showAvgTime,
}: {
  selectedDate: string;
  menuItems: MenuItem[];
  useTicket: boolean;
  showAvgTime: boolean;
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

  const Toggle = ({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) => (
    <label className="relative inline-flex items-center cursor-pointer shrink-0">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} className="sr-only peer" disabled={isSaving} />
      <div className="w-12 h-6.5 bg-stone-200 rounded-full peer peer-checked:bg-[#a8823f] peer-checked:after:translate-x-[22px] after:content-[''] after:absolute after:top-[3px] after:left-[3px] after:bg-white after:rounded-full after:h-5 after:w-5 after:transition-all after:shadow-sm"></div>
    </label>
  );

  return (
    <div className="max-w-2xl mx-auto space-y-5">
      <div className="bg-white rounded-xl border border-stone-200 shadow-[0_1px_3px_rgba(40,33,26,0.05)] p-6 flex items-center justify-between gap-4">
        <div>
          <h2 className="text-sm font-semibold text-stone-800 flex items-center gap-1.5">
            整理番号システム
            <InfoTip text="オンにすると、レジで注文ごとに整理番号を発行できます。番号は自動で1ずつ増え、手入力でも変更できます。" align="left" />
          </h2>
          <p className="text-sm text-stone-500 mt-1">レジで注文ごとに整理番号を発行します（自動で1から採番）。</p>
        </div>
        <Toggle checked={useTicket} onChange={(v) => run(() => mutateMenu(selectedDate, { type: "toggleTicket", value: v }))} />
      </div>

      <div className="bg-white rounded-xl border border-stone-200 shadow-[0_1px_3px_rgba(40,33,26,0.05)] p-6 flex items-center justify-between gap-4">
        <div>
          <h2 className="text-sm font-semibold text-stone-800 flex items-center gap-1.5">
            レジに平均提供時間を表示
            <InfoTip text="オンにすると、レジ画面の上部に「本日の平均提供時間（受注から提供までの平均）」が表示されます。混雑状況の目安になります。" align="left" />
          </h2>
          <p className="text-sm text-stone-500 mt-1">本日の受注〜提供の平均時間をレジ画面に表示します。</p>
        </div>
        <Toggle checked={showAvgTime} onChange={(v) => run(() => mutateMenu(selectedDate, { type: "toggleAvgTime", value: v }))} />
      </div>

      <div className="bg-white rounded-xl border border-stone-200 shadow-[0_1px_3px_rgba(40,33,26,0.05)] p-6">
        <h2 className="text-sm font-semibold text-stone-800 mb-4 flex items-center gap-1.5">
          メニュー設定
          <InfoTip text="この営業日に販売する商品を登録します。カテゴリ・商品名・価格を入れて「追加」。各商品は「販売中 / 在庫なし」を切り替えたり削除できます。メニューは営業日ごとに保存されます。" align="left" />
        </h2>
        <form onSubmit={handleAddItem} className="flex flex-col sm:flex-row gap-2.5 mb-6 bg-stone-50 p-3.5 rounded-lg border border-stone-200">
          <select
            value={newItemCategory}
            onChange={(e) => setNewItemCategory(e.target.value)}
            className="w-full sm:w-1/3 px-2.5 py-2 border border-stone-300 rounded-md focus:border-[#a8823f] focus:outline-none text-sm bg-white font-medium"
          >
            <option value="コーヒー">コーヒー</option>
            <option value="お菓子">お菓子</option>
            <option value="その他">その他</option>
          </select>
          <input
            type="text"
            placeholder="商品名"
            value={newItemName}
            onChange={(e) => setNewItemName(e.target.value)}
            className="flex-1 px-2.5 py-2 border border-stone-300 rounded-md focus:border-[#a8823f] focus:outline-none text-sm"
          />
          <div className="flex items-center bg-white border border-stone-300 rounded-md focus-within:border-[#a8823f] overflow-hidden">
            <span className="px-2.5 text-stone-400 text-sm font-mono border-r border-stone-300 bg-stone-50">¥</span>
            <input
              type="number"
              placeholder="価格"
              value={newItemPrice}
              onChange={(e) => setNewItemPrice(e.target.value)}
              className="w-24 px-2.5 py-2 focus:outline-none text-sm font-mono tnum"
            />
          </div>
          <button
            type="submit"
            disabled={isSaving || !newItemName.trim() || !newItemPrice.trim()}
            className="bg-stone-900 hover:bg-stone-800 text-white font-medium px-5 py-2 rounded-lg text-sm transition-colors disabled:bg-stone-200 disabled:text-stone-400"
          >
            追加
          </button>
        </form>

        <div className="space-y-3">
          <h3 className="text-[11px] font-semibold uppercase tracking-[0.12em] text-stone-400">登録メニュー（{menuItems.length}）</h3>
          {menuItems.length === 0 ? (
            <p className="text-sm text-stone-400 py-6 text-center border border-dashed border-stone-200 rounded-lg">メニューが登録されていません。</p>
          ) : (
            <div className="grid grid-cols-1 gap-1.5">
              {menuItems.map((item) => (
                <div key={item.id} className={`flex justify-between items-center px-3.5 py-2.5 border rounded-lg ${item.soldOut ? "border-red-200 bg-red-50/50" : "border-stone-200 bg-white"}`}>
                  <div className="flex items-center gap-3 min-w-0">
                    <span className="text-[10px] uppercase tracking-wider bg-stone-100 px-2 py-0.5 rounded text-stone-500 font-semibold shrink-0">
                      {(CATEGORIES as string[]).includes(item.category) ? item.category : "その他"}
                    </span>
                    <span className={`text-sm font-medium truncate ${item.soldOut ? "text-red-400 line-through" : "text-stone-800"}`}>{item.name}</span>
                  </div>
                  <div className="flex items-center gap-3 shrink-0">
                    <span className="text-sm font-mono font-semibold text-stone-500 tnum">¥{item.price.toLocaleString()}</span>
                    <button
                      onClick={() => run(() => mutateMenu(selectedDate, { type: "toggleSoldOut", id: item.id, value: !item.soldOut }))}
                      disabled={isSaving}
                      className={`text-[10px] uppercase tracking-wider font-bold px-2.5 py-1 rounded-full transition-colors disabled:opacity-50 ${
                        item.soldOut ? "bg-red-500 text-white hover:bg-red-600" : "bg-emerald-50 text-emerald-600 hover:bg-emerald-100"
                      }`}
                    >
                      {item.soldOut ? "在庫なし" : "販売中"}
                    </button>
                    {confirmDeleteId === item.id ? (
                      <div className="flex items-center gap-1">
                        <button onClick={() => handleDeleteItem(item.id)} disabled={isSaving} className="bg-red-600 text-white font-medium text-[10px] px-2 py-1 rounded hover:bg-red-700 disabled:opacity-50">
                          削除
                        </button>
                        <button onClick={() => setConfirmDeleteId(null)} disabled={isSaving} className="bg-white text-stone-500 border border-stone-200 font-medium text-[10px] px-2 py-1 rounded hover:bg-stone-50">
                          戻る
                        </button>
                      </div>
                    ) : (
                      <button onClick={() => setConfirmDeleteId(item.id)} className="text-stone-400 hover:text-red-600 text-xs font-medium transition-colors">
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
