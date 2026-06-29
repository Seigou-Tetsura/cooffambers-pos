import { doc, runTransaction } from "firebase/firestore";
import { db } from "./firebase";
import { RawMenuItem, CatDef, DEFAULT_CATEGORIES } from "./types";

// undefined値を除去（Firestoreは配列要素内でundefinedもdeleteField()も非対応）
function sanitizeItem(item: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(item).filter(([, v]) => v !== undefined));
}

// ==========================================
// メニュー（menus/{営業日}）の安全な更新
// 複数人が同時に設定を触ってもデータが先祖返りしないよう
// 必ず Transaction + merge で適用する
// ==========================================
export type MenuAction =
  | { type: "add"; item: RawMenuItem }
  | { type: "delete"; id: string }
  | { type: "editItem"; id: string; name: string; price: number; hotPrice?: number; icePrice?: number }
  | { type: "moveItem"; id: string; dir: -1 | 1 }
  | { type: "toggleTicket"; value: boolean }
  | { type: "toggleAvgTime"; value: boolean }
  | { type: "toggleSoldOut"; id: string; value: boolean }
  | { type: "addCategory"; cat: CatDef }
  | { type: "renameCategory"; id: string; name: string }
  | { type: "toggleCategoryTemp"; id: string; value: boolean }
  | { type: "moveCategory"; id: string; dir: -1 | 1 }
  | { type: "deleteCategory"; id: string };

interface MenuDoc {
  items?: RawMenuItem[];
  useTicket?: boolean;
  showAvgTime?: boolean;
  categories?: CatDef[];
}

const swap = <T>(arr: T[], i: number, j: number): T[] => {
  if (i < 0 || j < 0 || i >= arr.length || j >= arr.length) return arr;
  const next = [...arr];
  [next[i], next[j]] = [next[j], next[i]];
  return next;
};

export async function mutateMenu(date: string, action: MenuAction): Promise<void> {
  await runTransaction(db, async (transaction) => {
    const ref = doc(db, "menus", date);
    const snap = await transaction.get(ref);
    const data: MenuDoc = snap.exists() ? (snap.data() as MenuDoc) : {};
    let items: RawMenuItem[] = data.items ?? [];
    let useTicket: boolean = data.useTicket ?? false;
    let showAvgTime: boolean = data.showAvgTime ?? false;
    let categories: CatDef[] = data.categories && data.categories.length ? data.categories : DEFAULT_CATEGORIES;

    switch (action.type) {
      case "add":
        items = [...items, sanitizeItem(action.item as unknown as Record<string, unknown>) as unknown as RawMenuItem];
        break;
      case "delete":
        items = items.filter((i) => String(i.id) !== action.id);
        break;
      case "editItem":
        items = items.map((i) =>
          String(i.id) === action.id
            ? sanitizeItem({ ...i, name: action.name, price: action.price, hotPrice: action.hotPrice, icePrice: action.icePrice }) as unknown as RawMenuItem
            : i
        );
        break;
      case "moveItem": {
        const idx = items.findIndex((i) => String(i.id) === action.id);
        items = swap(items, idx, idx + action.dir);
        break;
      }
      case "toggleTicket":
        useTicket = action.value;
        break;
      case "toggleAvgTime":
        showAvgTime = action.value;
        break;
      case "toggleSoldOut":
        items = items.map((i) => (String(i.id) === action.id ? { ...i, soldOut: action.value } : i));
        break;
      case "addCategory":
        categories = [...categories, action.cat];
        break;
      case "renameCategory": {
        const target = categories.find((c) => c.id === action.id);
        const oldName = target?.name;
        categories = categories.map((c) => (c.id === action.id ? { ...c, name: action.name } : c));
        if (oldName && oldName !== action.name) {
          items = items.map((i) => (i.category === oldName ? { ...i, category: action.name } : i));
        }
        break;
      }
      case "toggleCategoryTemp":
        categories = categories.map((c) => (c.id === action.id ? { ...c, hasTemp: action.value } : c));
        break;
      case "moveCategory": {
        const idx = categories.findIndex((c) => c.id === action.id);
        categories = swap(categories, idx, idx + action.dir);
        break;
      }
      case "deleteCategory": {
        const target = categories.find((c) => c.id === action.id);
        const remaining = categories.filter((c) => c.id !== action.id);
        const fallback = remaining[0]?.name ?? "その他";
        if (target) {
          items = items.map((i) => (i.category === target.name ? { ...i, category: fallback } : i));
        }
        categories = remaining;
        break;
      }
    }

    transaction.set(ref, { items, useTicket, showAvgTime, categories }, { merge: true });
  });
}
