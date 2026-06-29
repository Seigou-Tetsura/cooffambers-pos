"use client";

import { useState, useRef } from "react";
import { MenuItem, CatDef } from "../lib/types";
import { parseToNumber } from "../lib/utils";
import { mutateMenu } from "../lib/menu";
import { useToast } from "../lib/toast";
import { InfoTip } from "../lib/info";

// 日本語IME変換中にonChangeが発火するのを防ぐhook
function useJapaneseInput(setValue: (v: string) => void) {
  const composing = useRef(false);
  return {
    onChange: (e: React.ChangeEvent<HTMLInputElement>) => {
      if (!composing.current) setValue(e.target.value);
    },
    onCompositionStart: () => { composing.current = true; },
    onCompositionEnd: (e: React.CompositionEvent<HTMLInputElement>) => {
      composing.current = false;
      setValue(e.currentTarget.value);
    },
  };
}

const PriceInput = ({ label, placeholder, value, onChange, color }: {
  label: string; placeholder: string; value: string;
  onChange: (v: string) => void; color?: "red" | "blue";
}) => (
  <div className="flex items-center gap-1">
    <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full shrink-0 ${
      color === "red" ? "bg-red-100 text-red-700" : color === "blue" ? "bg-blue-100 text-blue-700" : "bg-stone-100 text-stone-500"
    }`}>{label}</span>
    <div className="flex items-center bg-white border border-stone-300 rounded-md focus-within:border-[#a8823f] overflow-hidden">
      <span className="px-1.5 text-stone-400 text-xs font-mono border-r border-stone-200 bg-stone-50">¥</span>
      <input type="number" placeholder={placeholder} value={value} onChange={(e) => onChange(e.target.value)}
        className="w-20 px-2 py-1.5 focus:outline-none text-sm font-mono tnum" />
    </div>
  </div>
);

const Chevron = ({ up = false }: { up?: boolean }) => (
  <svg viewBox="0 0 12 12" className={`w-3 h-3 ${up ? "rotate-180" : ""}`} fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
    <path d="M2.5 4.5L6 8l3.5-3.5" />
  </svg>
);

// ==========================================
// メニュー設定（SettingsView）
// カテゴリ管理／メニューのインライン編集・並び替えに対応
// ==========================================
export default function SettingsView({
  selectedDate,
  menuItems,
  categories,
  useTicket,
  showAvgTime,
}: {
  selectedDate: string;
  menuItems: MenuItem[];
  categories: CatDef[];
  useTicket: boolean;
  showAvgTime: boolean;
}) {
  const { showError } = useToast();
  const [isSaving, setIsSaving] = useState(false);

  // メニュー追加フォーム
  const [newItemName, setNewItemName] = useState("");
  const [newItemPrice, setNewItemPrice] = useState("");
  const [newItemCategory, setNewItemCategory] = useState("");
  const [newItemHotPrice, setNewItemHotPrice] = useState("");
  const [newItemIcePrice, setNewItemIcePrice] = useState("");

  // メニュー行のインライン編集
  const [editId, setEditId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [editPrice, setEditPrice] = useState("");
  const [editHotPrice, setEditHotPrice] = useState("");
  const [editIcePrice, setEditIcePrice] = useState("");
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  // カテゴリ
  const [newCatName, setNewCatName] = useState("");
  const [newCatTemp, setNewCatTemp] = useState(false);
  const [editCatId, setEditCatId] = useState<string | null>(null);
  const [editCatName, setEditCatName] = useState("");
  const [confirmDelCatId, setConfirmDelCatId] = useState<string | null>(null);

  const itemCat = categories.some((c) => c.name === newItemCategory) ? newItemCategory : categories[0]?.name ?? "";

  const newItemNameInput = useJapaneseInput(setNewItemName);
  const newCatNameInput = useJapaneseInput(setNewCatName);
  const editNameInput = useJapaneseInput(setEditName);
  const editCatNameInput = useJapaneseInput(setEditCatName);

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

  // ---- メニュー ----
  const handleAddItem = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newItemName.trim() || !itemCat) return;
    const hotPrice = newItemHotPrice ? parseToNumber(newItemHotPrice) : undefined;
    const icePrice = newItemIcePrice ? parseToNumber(newItemIcePrice) : undefined;
    const price = parseToNumber(newItemPrice);
    if (!hotPrice && !icePrice && price <= 0) {
      showError("通常価格、またはHOT/ICEいずれかの価格を入力してください。");
      return;
    }
    run(() =>
      mutateMenu(selectedDate, {
        type: "add",
        item: { id: Date.now().toString(), name: newItemName.trim(), price, category: itemCat, soldOut: false, hotPrice, icePrice },
      })
    );
    setNewItemName("");
    setNewItemPrice("");
    setNewItemHotPrice("");
    setNewItemIcePrice("");
  };

  const startEdit = (item: MenuItem) => {
    setEditId(item.id);
    setEditName(item.name);
    setEditPrice(String(item.price));
    setEditHotPrice(item.hotPrice != null ? String(item.hotPrice) : "");
    setEditIcePrice(item.icePrice != null ? String(item.icePrice) : "");
    setConfirmDeleteId(null);
  };
  const saveEdit = (id: string) => {
    const price = parseToNumber(editPrice);
    const hotPrice = editHotPrice ? parseToNumber(editHotPrice) : undefined;
    const icePrice = editIcePrice ? parseToNumber(editIcePrice) : undefined;
    if (!editName.trim()) {
      showError("商品名を入力してください。");
      return;
    }
    if (!hotPrice && !icePrice && price <= 0) {
      showError("通常価格、またはHOT/ICEいずれかの価格を入力してください。");
      return;
    }
    run(() => mutateMenu(selectedDate, { type: "editItem", id, name: editName.trim(), price, hotPrice, icePrice }));
    setEditId(null);
  };

  // ---- カテゴリ ----
  const handleAddCategory = (e: React.FormEvent) => {
    e.preventDefault();
    const name = newCatName.trim();
    if (!name) return;
    if (categories.some((c) => c.name === name)) {
      showError("同じ名前のカテゴリが既にあります。");
      return;
    }
    run(() => mutateMenu(selectedDate, { type: "addCategory", cat: { id: `cat${Date.now()}`, name, hasTemp: newCatTemp } }));
    setNewCatName("");
    setNewCatTemp(false);
  };
  const saveCatName = (id: string) => {
    const name = editCatName.trim();
    if (!name) return;
    run(() => mutateMenu(selectedDate, { type: "renameCategory", id, name }));
    setEditCatId(null);
  };

  return (
    <div className="max-w-3xl mx-auto space-y-5">
      {/* トグル系 */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
        <div className="bg-white rounded-xl border border-stone-200 shadow-[0_1px_3px_rgba(40,33,26,0.05)] p-5 flex items-center justify-between gap-3">
          <div>
            <h2 className="text-sm font-semibold text-stone-800 flex items-center gap-1.5">
              整理番号システム
              <InfoTip text="オンにすると、レジで注文ごとに整理番号を発行できます。番号は自動で1ずつ増え、手入力でも変更できます。" align="left" />
            </h2>
            <p className="text-xs text-stone-500 mt-1">注文ごとに整理番号を発行（自動採番）。</p>
          </div>
          <label className="relative inline-flex items-center cursor-pointer shrink-0">
            <input type="checkbox" checked={useTicket} onChange={(e) => run(() => mutateMenu(selectedDate, { type: "toggleTicket", value: e.target.checked }))} className="sr-only peer" disabled={isSaving} />
            <div className="w-12 h-6.5 bg-stone-200 rounded-full peer peer-checked:bg-[#a8823f] peer-checked:after:translate-x-[22px] after:content-[''] after:absolute after:top-[3px] after:left-[3px] after:bg-white after:rounded-full after:h-5 after:w-5 after:transition-all after:shadow-sm"></div>
          </label>
        </div>

        <div className="bg-white rounded-xl border border-stone-200 shadow-[0_1px_3px_rgba(40,33,26,0.05)] p-5 flex items-center justify-between gap-3">
          <div>
            <h2 className="text-sm font-semibold text-stone-800 flex items-center gap-1.5">
              平均提供時間を表示
              <InfoTip text="オンにすると、レジ画面の上部に「本日の平均提供時間（受注から提供までの平均）」が表示されます。" align="left" />
            </h2>
            <p className="text-xs text-stone-500 mt-1">本日の受注〜提供の平均をレジに表示。</p>
          </div>
          <label className="relative inline-flex items-center cursor-pointer shrink-0">
            <input type="checkbox" checked={showAvgTime} onChange={(e) => run(() => mutateMenu(selectedDate, { type: "toggleAvgTime", value: e.target.checked }))} className="sr-only peer" disabled={isSaving} />
            <div className="w-12 h-6.5 bg-stone-200 rounded-full peer peer-checked:bg-[#a8823f] peer-checked:after:translate-x-[22px] after:content-[''] after:absolute after:top-[3px] after:left-[3px] after:bg-white after:rounded-full after:h-5 after:w-5 after:transition-all after:shadow-sm"></div>
          </label>
        </div>
      </div>

      {/* カテゴリ設定 */}
      <div className="bg-white rounded-xl border border-stone-200 shadow-[0_1px_3px_rgba(40,33,26,0.05)] p-6">
        <h2 className="text-sm font-semibold text-stone-800 mb-4 flex items-center gap-1.5">
          カテゴリ設定
          <InfoTip text="商品のカテゴリを追加・改名・並び替え・削除できます。「HOT/ICE」をオンにしたカテゴリの商品は、レジで温度を選べます。カテゴリを削除すると、その商品は先頭のカテゴリへ移動します。" align="left" />
        </h2>

        <form onSubmit={handleAddCategory} className="flex flex-col sm:flex-row gap-2.5 mb-5 bg-stone-50 p-3.5 rounded-lg border border-stone-200">
          <input
            type="text"
            placeholder="新しいカテゴリ名"
            value={newCatName}
            {...newCatNameInput}
            className="flex-1 px-2.5 py-2 border border-stone-300 rounded-md focus:border-[#a8823f] focus:outline-none text-sm"
          />
          <button type="submit" disabled={isSaving || !newCatName.trim()} className="bg-stone-900 hover:bg-stone-800 text-white font-medium px-5 py-2 rounded-lg text-sm whitespace-nowrap shrink-0 transition-colors disabled:bg-stone-200 disabled:text-stone-400">
            カテゴリ追加
          </button>
        </form>

        <div className="grid grid-cols-1 gap-1.5">
          {categories.map((cat, idx) => (
            <div key={cat.id} className="flex justify-between items-center px-3.5 py-2.5 border border-stone-200 rounded-lg gap-2">
              <div className="flex items-center gap-1.5 min-w-0 flex-1">
                <div className="flex flex-col">
                  <button onClick={() => run(() => mutateMenu(selectedDate, { type: "moveCategory", id: cat.id, dir: -1 }))} disabled={isSaving || idx === 0} className="text-stone-400 hover:text-stone-700 disabled:opacity-20 disabled:hover:text-stone-400 h-3 flex items-center"><Chevron up /></button>
                  <button onClick={() => run(() => mutateMenu(selectedDate, { type: "moveCategory", id: cat.id, dir: 1 }))} disabled={isSaving || idx === categories.length - 1} className="text-stone-400 hover:text-stone-700 disabled:opacity-20 disabled:hover:text-stone-400 h-3 flex items-center"><Chevron /></button>
                </div>
                {editCatId === cat.id ? (
                  <input
                    value={editCatName}
                    {...editCatNameInput}
                    onKeyDown={(e) => e.key === "Enter" && saveCatName(cat.id)}
                    autoFocus
                    className="flex-1 min-w-0 px-2 py-1 border border-stone-300 rounded text-sm focus:border-[#a8823f] focus:outline-none"
                  />
                ) : (
                  <span className="text-sm font-medium text-stone-800 truncate">{cat.name}</span>
                )}
              </div>
              <div className="flex items-center gap-2 shrink-0">
                {editCatId === cat.id ? (
                  <>
                    <button onClick={() => saveCatName(cat.id)} disabled={isSaving} className="bg-stone-900 text-white font-medium text-[10px] px-2.5 py-1 rounded hover:bg-stone-800 disabled:opacity-50">保存</button>
                    <button onClick={() => setEditCatId(null)} className="bg-white text-stone-500 border border-stone-200 font-medium text-[10px] px-2.5 py-1 rounded hover:bg-stone-50">取消</button>
                  </>
                ) : confirmDelCatId === cat.id ? (
                  <>
                    <button onClick={() => { run(() => mutateMenu(selectedDate, { type: "deleteCategory", id: cat.id })); setConfirmDelCatId(null); }} disabled={isSaving || categories.length <= 1} className="bg-red-600 text-white font-medium text-[10px] px-2 py-1 rounded hover:bg-red-700 disabled:opacity-40">削除</button>
                    <button onClick={() => setConfirmDelCatId(null)} className="bg-white text-stone-500 border border-stone-200 font-medium text-[10px] px-2 py-1 rounded hover:bg-stone-50">戻る</button>
                  </>
                ) : (
                  <>
                    <button onClick={() => { setEditCatId(cat.id); setEditCatName(cat.name); }} className="text-stone-400 hover:text-stone-700 text-xs font-medium">改名</button>
                    <button onClick={() => setConfirmDelCatId(cat.id)} disabled={categories.length <= 1} className="text-stone-400 hover:text-red-600 text-xs font-medium disabled:opacity-30 disabled:hover:text-stone-400">削除</button>
                  </>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* メニュー設定 */}
      <div className="bg-white rounded-xl border border-stone-200 shadow-[0_1px_3px_rgba(40,33,26,0.05)] p-6">
        <h2 className="text-sm font-semibold text-stone-800 mb-4 flex items-center gap-1.5">
          メニュー設定
          <InfoTip text="商品を追加・編集・並び替え・削除できます。各商品は「販売中 / 在庫なし」も切り替えられます。メニューは営業日ごとに保存されます。" align="left" />
        </h2>
        <form onSubmit={handleAddItem} className="flex flex-col gap-2.5 mb-6 bg-stone-50 p-3.5 rounded-lg border border-stone-200">
          <div className="flex flex-col sm:flex-row gap-2.5">
            <select value={itemCat} onChange={(e) => setNewItemCategory(e.target.value)} className="w-full sm:w-1/3 px-2.5 py-2 border border-stone-300 rounded-md focus:border-[#a8823f] focus:outline-none text-sm bg-white font-medium">
              {categories.map((c) => (
                <option key={c.id} value={c.name}>{c.name}</option>
              ))}
            </select>
            <input type="text" placeholder="商品名" value={newItemName} {...newItemNameInput} className="flex-1 px-2.5 py-2 border border-stone-300 rounded-md focus:border-[#a8823f] focus:outline-none text-sm" />
            <button type="submit" disabled={isSaving || !newItemName.trim() || (!newItemPrice.trim() && !newItemHotPrice.trim() && !newItemIcePrice.trim())} className="bg-stone-900 hover:bg-stone-800 text-white font-medium px-5 py-2 rounded-lg text-sm whitespace-nowrap shrink-0 transition-colors disabled:bg-stone-200 disabled:text-stone-400">
              追加
            </button>
          </div>
          <div className="flex flex-wrap gap-2.5 items-center px-0.5">
            <PriceInput label="通常" placeholder="HOT/ICE なし" value={newItemPrice} onChange={setNewItemPrice} />
            <PriceInput label="HOT" placeholder="HOT価格" value={newItemHotPrice} onChange={setNewItemHotPrice} color="red" />
            <PriceInput label="ICE" placeholder="ICE価格" value={newItemIcePrice} onChange={setNewItemIcePrice} color="blue" />
          </div>
        </form>

        <div className="space-y-3">
          <h3 className="text-[11px] font-semibold uppercase tracking-[0.12em] text-stone-400">登録メニュー（{menuItems.length}）</h3>
          {menuItems.length === 0 ? (
            <p className="text-sm text-stone-400 py-6 text-center border border-dashed border-stone-200 rounded-lg">メニューが登録されていません。</p>
          ) : (
            <div className="grid grid-cols-1 gap-1.5">
              {menuItems.map((item, idx) => (
                <div key={item.id} className={`flex justify-between items-center px-3 py-2.5 border rounded-lg gap-2 ${item.soldOut ? "border-red-200 bg-red-50/50" : "border-stone-200 bg-white"}`}>
                  <div className="flex items-center gap-1.5 min-w-0 flex-1">
                    <div className="flex flex-col shrink-0">
                      <button onClick={() => run(() => mutateMenu(selectedDate, { type: "moveItem", id: item.id, dir: -1 }))} disabled={isSaving || idx === 0} className="text-stone-400 hover:text-stone-700 disabled:opacity-20 disabled:hover:text-stone-400 h-3 flex items-center"><Chevron up /></button>
                      <button onClick={() => run(() => mutateMenu(selectedDate, { type: "moveItem", id: item.id, dir: 1 }))} disabled={isSaving || idx === menuItems.length - 1} className="text-stone-400 hover:text-stone-700 disabled:opacity-20 disabled:hover:text-stone-400 h-3 flex items-center"><Chevron /></button>
                    </div>
                    <span className="text-[10px] uppercase tracking-wider bg-stone-100 px-2 py-0.5 rounded text-stone-500 font-semibold shrink-0">{item.category}</span>
                    {editId === item.id ? (
                      <div className="flex flex-col gap-1.5 min-w-0 flex-1">
                        <input value={editName} {...editNameInput} className="min-w-0 px-2 py-1 border border-stone-300 rounded text-sm focus:border-[#a8823f] focus:outline-none" />
                        <div className="flex flex-wrap gap-2 items-center">
                          <PriceInput label="通常" placeholder="HOT/ICEなし" value={editPrice} onChange={setEditPrice} />
                          <PriceInput label="HOT" placeholder="HOT価格" value={editHotPrice} onChange={setEditHotPrice} color="red" />
                          <PriceInput label="ICE" placeholder="ICE価格" value={editIcePrice} onChange={setEditIcePrice} color="blue" />
                        </div>
                      </div>
                    ) : (
                      <>
                        <span className={`text-sm font-medium truncate ${item.soldOut ? "text-red-400 line-through" : "text-stone-800"}`}>{item.name}</span>
                        <div className="flex items-center gap-1 shrink-0">
                          {item.hotPrice != null && (
                            <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-full bg-red-100 text-red-700">HOT ¥{item.hotPrice.toLocaleString()}</span>
                          )}
                          {item.icePrice != null && (
                            <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-full bg-blue-100 text-blue-700">ICE ¥{item.icePrice.toLocaleString()}</span>
                          )}
                          {item.hotPrice == null && item.icePrice == null && (
                            <span className="text-sm font-mono font-semibold text-stone-500 tnum">¥{item.price.toLocaleString()}</span>
                          )}
                        </div>
                      </>
                    )}
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    {editId === item.id ? (
                      <>
                        <button onClick={() => saveEdit(item.id)} disabled={isSaving} className="bg-stone-900 text-white font-medium text-[10px] px-2.5 py-1 rounded hover:bg-stone-800 disabled:opacity-50">保存</button>
                        <button onClick={() => setEditId(null)} className="bg-white text-stone-500 border border-stone-200 font-medium text-[10px] px-2.5 py-1 rounded hover:bg-stone-50">取消</button>
                      </>
                    ) : confirmDeleteId === item.id ? (
                      <>
                        <button onClick={() => { run(() => mutateMenu(selectedDate, { type: "delete", id: item.id })); setConfirmDeleteId(null); }} disabled={isSaving} className="bg-red-600 text-white font-medium text-[10px] px-2 py-1 rounded hover:bg-red-700 disabled:opacity-50">削除</button>
                        <button onClick={() => setConfirmDeleteId(null)} className="bg-white text-stone-500 border border-stone-200 font-medium text-[10px] px-2 py-1 rounded hover:bg-stone-50">戻る</button>
                      </>
                    ) : (
                      <>
                        <button onClick={() => run(() => mutateMenu(selectedDate, { type: "toggleSoldOut", id: item.id, value: !item.soldOut }))} disabled={isSaving} className={`text-[10px] uppercase tracking-wider font-bold px-2.5 py-1 rounded-full transition-colors disabled:opacity-50 ${item.soldOut ? "bg-red-500 text-white hover:bg-red-600" : "bg-emerald-50 text-emerald-600 hover:bg-emerald-100"}`}>
                          {item.soldOut ? "在庫なし" : "販売中"}
                        </button>
                        <button onClick={() => startEdit(item)} className="text-stone-400 hover:text-stone-700 text-xs font-medium">編集</button>
                        <button onClick={() => setConfirmDeleteId(item.id)} className="text-stone-400 hover:text-red-600 text-xs font-medium">削除</button>
                      </>
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
