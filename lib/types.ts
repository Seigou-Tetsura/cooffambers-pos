import { Timestamp } from "firebase/firestore";

// ==========================================
// 共通の型定義（Types）
// ==========================================
export type Mode = "cashier" | "barista" | "dashboard" | "period" | "settings";

export type Category = "コーヒー" | "お菓子" | "その他";
export const CATEGORIES: Category[] = ["コーヒー", "お菓子", "その他"];

export interface MenuItem {
  id: string;
  name: string;
  price: number;
  category: string;
  soldOut: boolean; // 品切れ管理
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
