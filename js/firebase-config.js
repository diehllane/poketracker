// ─── Firebase Configuration ───────────────────────────────────────────────────
// Replace the values below with your own Firebase project credentials.
// Get these from: Firebase Console → Project Settings → Your apps → SDK setup

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { getAuth }        from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { getFirestore }   from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

const firebaseConfig = {
  apiKey:            "YOUR_API_KEY",
  authDomain:        "YOUR_PROJECT_ID.firebaseapp.com",
  projectId:         "YOUR_PROJECT_ID",
  storageBucket:     "YOUR_PROJECT_ID.appspot.com",
  messagingSenderId: "YOUR_MESSAGING_SENDER_ID",
  appId:             "YOUR_APP_ID"
};

const app = initializeApp(firebaseConfig);

export const auth = getAuth(app);
export const db   = getFirestore(app);

// ─── Admin UID ────────────────────────────────────────────────────────────────
// After creating your admin account in Firebase Auth, paste the UID here.
// Firebase Console → Authentication → Users → copy the UID of your admin account.
export const ADMIN_UID = "YOUR_ADMIN_UID_HERE";
