import { Timestamp } from "firebase/firestore";

// ==========================================
// 共通の型定義（Types）
// ==========================================
export type Mode = "cashier" | "barista" | "dashboard" | "period" | "settings";

// カテゴリ定義（営業日ごとに編集可能）。hasTemp が true のカテゴリは HOT/ICE を扱う
export interface CatDef {
  id: string;
  name: string;
  hasTemp: boolean;
}

export const DEFAULT_CATEGORIES: CatDef[] = [
  { id: "coffee", name: "コーヒー", hasTemp: true },
  { id: "snack", name: "お菓子", hasTemp: false },
  { id: "other", name: "その他", hasTemp: false },
];

export interface MenuItem {
  id: string;
  name: string;
  price: number;
  category: string; // カテゴリ名
  soldOut: boolean;
}

// Firestore から読み込んだ生データ（型が不定なので一度受ける）
export interface RawMenuItem {
  id: string | number;
  name: string;
  price: string | number;
  category: string;
  soldOut?: boolean;
}

export interface CartItem {
  id: string;
  name: string;
  price: number;
  temperature?: "Hot" | "Ice";
  quantity: number;
  category: string;
  served?: boolean; // 商品ごとの提供済みチェック
}

export interface Order {
  id: string;
  orderNumber: number;
  items: CartItem[];
  totalPrice: number;
  status: "pending" | "completed" | "cancelled"; // 物理削除を廃止し「取消済」を採用
  date: string;
  createdAt: Timestamp | null;
  completedAt?: Timestamp | null; // 提供完了した時刻（完了一覧の並び替え用）
  ticketNumber?: string | null;
}
