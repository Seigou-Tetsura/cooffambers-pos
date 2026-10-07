import { doc, runTransaction } from "firebase/firestore";
import { db } from "./firebase";

// ==========================================
// 店舗（出店場所）
// 学祭のように同じ営業日に「模擬店」と「教室」など複数の場所で出店する場合、
// メニュー・在庫・注文・整理番号を店舗ごとに分けて管理する。
// 店舗の一覧は config/stores に保存し、各端末がどの店舗を操作するかは端末ごとに記憶する
// ==========================================
export interface StoreDef {
  id: string;
  name: string;
}

// 店舗機能を入れる前のデータ（store 欄の無い注文・menus/{営業日}）はすべてこの店舗として扱う
export const MAIN_STORE_ID = "main";
export const DEFAULT_STORES: StoreDef[] = [{ id: MAIN_STORE_ID, name: "メイン" }];

// メニュー（在庫・カテゴリ・整理番号設定を含む）のドキュメントID。
// メイン店舗は従来どおり営業日そのもの（既存データをそのまま読める）、それ以外は「営業日__店舗ID」
export const menuDocId = (date: string, storeId: string): string =>
  storeId === MAIN_STORE_ID ? date : `${date}__${storeId}`;

// 注文がどの店舗のものか（store 欄の無い既存注文はメイン店舗）
export const orderStoreId = (order: { store?: string | null }): string => order.store || MAIN_STORE_ID;

export type StoreAction =
  | { type: "add"; name: string }
  | { type: "rename"; id: string; name: string }
  | { type: "delete"; id: string };

// 店舗一覧の更新（メニューと同じく Transaction で先祖返りを防ぐ）。
// 店舗を削除しても、その店舗の注文・メニューは消さない（一覧から外れるだけ。期間集計には残る）
export async function mutateStores(action: StoreAction): Promise<void> {
  await runTransaction(db, async (transaction) => {
    const ref = doc(db, "config", "stores");
    const snap = await transaction.get(ref);
    const raw = snap.exists() ? (snap.data().stores as StoreDef[] | undefined) : undefined;
    let stores: StoreDef[] = Array.isArray(raw) && raw.length ? raw : DEFAULT_STORES;

    switch (action.type) {
      case "add":
        stores = [...stores, { id: `s${Date.now()}`, name: action.name }];
        break;
      case "rename":
        stores = stores.map((s) => (s.id === action.id ? { ...s, name: action.name } : s));
        break;
      case "delete":
        if (action.id === MAIN_STORE_ID) throw new Error("メイン店舗は削除できません");
        stores = stores.filter((s) => s.id !== action.id);
        break;
    }

    transaction.set(ref, { stores }, { merge: true });
  });
}
