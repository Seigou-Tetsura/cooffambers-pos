import { initializeApp } from "firebase/app";
import { getFirestore } from "firebase/firestore";
import { getAuth, signInAnonymously, onAuthStateChanged, User } from "firebase/auth";

// Firebase の apiKey は「秘密鍵」ではなくプロジェクトの識別子なので、
// クライアントに置いて問題ない。アクセス制御は Firestore セキュリティルールで行う。
const firebaseConfig = {
  apiKey: "AIzaSyCXtPVp-mJx9hKt3gXOBeXgIRzXDBSnE5M",
  authDomain: "coffee-sales-39c23.firebaseapp.com",
  projectId: "coffee-sales-39c23",
  storageBucket: "coffee-sales-39c23.firebasestorage.app",
  messagingSenderId: "1039210676890",
  appId: "1:1039210676890:web:bfcdf88b3ecea106d39523"
};

const app = initializeApp(firebaseConfig);
export const db = getFirestore(app);
export const auth = getAuth(app);

// 匿名認証：アプリを開いたら自動でサインインする。
// Firestore ルールを「request.auth != null」に絞るための土台（URLを知る第三者の読み書きを防ぐ）。
// コンソールで匿名認証が未有効でも落ちないよう、失敗時はそのまま進む（旧ルールなら動作継続）。
export function ensureSignedIn(onReady: (user: User | null) => void) {
  return onAuthStateChanged(auth, (user) => {
    if (user) {
      onReady(user);
    } else {
      signInAnonymously(auth).catch((e) => {
        console.error("匿名サインインに失敗（コンソールで匿名認証が有効か確認）:", e);
        onReady(null);
      });
    }
  });
}
