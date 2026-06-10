// Import the functions you need from the SDKs you need
import { initializeApp } from "firebase/app";
import { getFirestore } from "firebase/firestore"; // ←1行追加しました！

// Your web app's Firebase configuration
const firebaseConfig = {
  apiKey: "AIzaSyCXtPVp-mJx9hKt3gXOBeXgIRzXDBSnE5M",
  authDomain: "coffee-sales-39c23.firebaseapp.com",
  projectId: "coffee-sales-39c23",
  storageBucket: "coffee-sales-39c23.firebasestorage.app",
  messagingSenderId: "1039210676890",
  appId: "1:1039210676890:web:bfcdf88b3ecea106d39523"
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);
export const db = getFirestore(app); // ←もう1行追加しました！