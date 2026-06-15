import { doc, runTransaction } from "firebase/firestore";
import { db } from "./firebase";
import { RawMenuItem } from "./types";

// ==========================================
// メニュー（menus/{営業日}）の安全な更新
// 複数人が同時に設定を触ってもデータが先祖返りしないよう
// 必ず Transaction + merge で適用する
// ==========================================
export type MenuAction =
  | { type: "add"; item: RawMenuItem }
  | { type: "delete"; id: string }
  | { type: "toggleTicket"; value: boolean }
  | { type: "toggleAvgTime"; value: boolean }
  | { type: "toggleSoldOut"; id: string; value: boolean };

interface MenuDoc {
  items?: RawMenuItem[];
  useTicket?: boolean;
  showAvgTime?: boolean;
}

export async function mutateMenu(date: string, action: MenuAction): Promise<void> {
  await runTransaction(db, async (transaction) => {
    const ref = doc(db, "menus", date);
    const snap = await transaction.get(ref);
    const data: MenuDoc = snap.exists() ? (snap.data() as MenuDoc) : { items: [], useTicket: false, showAvgTime: false };
    let items: RawMenuItem[] = data.items ?? [];
    let useTicket: boolean = data.useTicket ?? false;
    let showAvgTime: boolean = data.showAvgTime ?? false;

    switch (action.type) {
      case "add":
        items = [...items, action.item];
        break;
      case "delete":
        items = items.filter((i) => String(i.id) !== action.id);
        break;
      case "toggleTicket":
        useTicket = action.value;
        break;
      case "toggleAvgTime":
        showAvgTime = action.value;
        break;
      case "toggleSoldOut":
        items = items.map((i) => (String(i.id) === action.id ? { ...i, soldOut: action.value } : i));
        break;
    }

    transaction.set(ref, { items, useTicket, showAvgTime }, { merge: true });
  });
}
