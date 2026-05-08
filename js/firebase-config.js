// ─── Firebase Configuration ───────────────────────────────────────────────────
// Replace the values below with your own Firebase project credentials.
// Get these from: Firebase Console → Project Settings → Your apps → SDK setup

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { getAuth }        from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { getFirestore }   from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

const firebaseConfig = {
  apiKey: "AIzaSyA0IbHCZJ4iR_KP8r2UO4a_imPB_f00UF0",
  authDomain: "pno-daycare-loans.firebaseapp.com",
  projectId: "pno-daycare-loans",
  storageBucket: "pno-daycare-loans.firebasestorage.app",
  messagingSenderId: "20189403333",
  appId: "1:20189403333:web:69139bca8a51b66429b8ac",
  measurementId: "G-M9FP07B9QV"
};

const app = initializeApp(firebaseConfig);

export const auth = getAuth(app);
export const db   = getFirestore(app);

// ─── Admin UID ────────────────────────────────────────────────────────────────
// After creating your admin account in Firebase Auth, paste the UID here.
// Firebase Console → Authentication → Users → copy the UID of your admin account.
export const ADMIN_UID = "3A08as7VmHgTsVqLuLQx7t97WSp1";
