import { doc, runTransaction, serverTimestamp } from "firebase/firestore";
import { db } from "./firebase";
import { RawMenuItem, CartItem, CatDef, DEFAULT_CATEGORIES } from "./types";
import { parseToNumber, baseItemId } from "./utils";

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
  | { type: "editItem"; id: string; name: string; price: number; hotPrice?: number; icePrice?: number; stock?: number }
  | { type: "moveItem"; id: string; dir: -1 | 1 }
  | { type: "setStock"; id: string; value: number | null } // null = 在庫管理をやめる
  | { type: "consumeStock"; deltas: { id: string; qty: number }[] } // 注文確定時に在庫を減算（0で下限クランプ）
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
            ? sanitizeItem({ ...i, name: action.name, price: action.price, hotPrice: action.hotPrice, icePrice: action.icePrice, stock: action.stock }) as unknown as RawMenuItem
            : i
        );
        break;
      case "setStock":
        items = items.map((i) =>
          String(i.id) === action.id
            ? sanitizeItem({ ...i, stock: action.value === null ? undefined : Math.max(0, action.value) }) as unknown as RawMenuItem
            : i
        );
        break;
      case "consumeStock": {
        const deltaMap = new Map(action.deltas.map((d) => [d.id, d.qty]));
        items = items.map((i) => {
          const qty = deltaMap.get(String(i.id));
          if (!qty || i.stock == null) return i;
          return { ...i, stock: Math.max(0, parseToNumber(i.stock) - qty) };
        });
        break;
      }
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

// ==========================================
// 注文の取消＋在庫の足し戻し
// ステータス更新と在庫加算を同じ Transaction で行うことで、
// 2台の端末が同時に取消しても在庫が二重に戻らないようにする
// ==========================================
export async function cancelOrderWithRestock(orderId: string): Promise<number> {
  return await runTransaction(db, async (transaction) => {
    const orderRef = doc(db, "orders", orderId);
    const orderSnap = await transaction.get(orderRef);
    if (!orderSnap.exists()) throw new Error("注文が見つかりません");
    const order = orderSnap.data() as { status?: string; date?: string; items?: CartItem[] };
    if (order.status === "cancelled") return 0; // 既に他の端末で取消済み

    // 商品ID（HOT/ICE の枝番を除く）ごとの数量を集計
    const qtyByBase = new Map<string, number>();
    (order.items ?? []).forEach((i) => {
      const base = baseItemId(String(i.id));
      qtyByBase.set(base, (qtyByBase.get(base) || 0) + parseToNumber(i.quantity));
    });

    // 在庫管理中の商品にだけ数量を足し戻す（メニューから削除済みの商品はスキップ）
    let restockedQty = 0;
    if (order.date && qtyByBase.size > 0) {
      const menuRef = doc(db, "menus", order.date);
      const menuSnap = await transaction.get(menuRef);
      if (menuSnap.exists()) {
        const data = menuSnap.data() as MenuDoc;
        const items = (data.items ?? []).map((i) => {
          const qty = qtyByBase.get(String(i.id));
          if (!qty || i.stock == null) return i;
          restockedQty += qty;
          return { ...i, stock: parseToNumber(i.stock) + qty };
        });
        if (restockedQty > 0) transaction.set(menuRef, { items }, { merge: true });
      }
    }

    transaction.update(orderRef, { status: "cancelled" });
    return restockedQty;
  });
}

// ==========================================
// 注文の編集保存＋在庫の差分調整
// 編集前後の数量差分だけ在庫を増減する（増えた分は減算、減った分は足し戻し）。
// 取消と同様、注文の更新と在庫の調整を同じ Transaction で行う
// ==========================================
// 戻り値: 在庫を調整した商品の種類数（0 = 在庫管理中の商品に増減なし）
export async function updateOrderWithStockAdjust(orderId: string, newItems: CartItem[], newTotalPrice: number): Promise<number> {
  return await runTransaction(db, async (transaction) => {
    const orderRef = doc(db, "orders", orderId);
    const orderSnap = await transaction.get(orderRef);
    if (!orderSnap.exists()) throw new Error("注文が見つかりません");
    const order = orderSnap.data() as { status?: string; date?: string; items?: CartItem[] };
    // 取消済みの注文は在庫が既に足し戻されているため、ここで編集すると在庫がズレる
    if (order.status === "cancelled") throw new Error("この注文は取消済みのため編集できません");

    // 商品ID（HOT/ICE の枝番を除く）ごとに「編集後 − 編集前」の数量差分を集計
    const deltaByBase = new Map<string, number>();
    (order.items ?? []).forEach((i) => {
      const base = baseItemId(String(i.id));
      deltaByBase.set(base, (deltaByBase.get(base) || 0) - parseToNumber(i.quantity));
    });
    newItems.forEach((i) => {
      const base = baseItemId(String(i.id));
      deltaByBase.set(base, (deltaByBase.get(base) || 0) + parseToNumber(i.quantity));
    });

    // 在庫管理中の商品にだけ差分を適用（メニューから削除済みの商品はスキップ。0で下限クランプ）
    let adjustedKinds = 0;
    if (order.date) {
      const menuRef = doc(db, "menus", order.date);
      const menuSnap = await transaction.get(menuRef);
      if (menuSnap.exists()) {
        const data = menuSnap.data() as MenuDoc;
        const items = (data.items ?? []).map((i) => {
          const delta = deltaByBase.get(String(i.id));
          if (!delta || i.stock == null) return i;
          adjustedKinds += 1;
          return { ...i, stock: Math.max(0, parseToNumber(i.stock) - delta) };
        });
        if (adjustedKinds > 0) transaction.set(menuRef, { items }, { merge: true });
      }
    }

    transaction.update(orderRef, { items: newItems, totalPrice: newTotalPrice, updatedAt: serverTimestamp() });
    return adjustedKinds;
  });
}
