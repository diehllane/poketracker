import { auth } from "./firebase-config.js";
import {
  signInWithEmailAndPassword,
  onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";

// ─── Route guard: if already logged in, go to dashboard ───────────────────────
onAuthStateChanged(auth, (user) => {
  if (user) {
    window.location.href = "dashboard.html";
  }
});

// ─── Login form ───────────────────────────────────────────────────────────────
const form    = document.getElementById("loginForm");
const errEl   = document.getElementById("loginError");
const loginBtn = document.getElementById("loginBtn");

form.addEventListener("submit", async (e) => {
  e.preventDefault();
  errEl.classList.add("hidden");
  loginBtn.disabled = true;
  loginBtn.textContent = "Signing in…";

  const email    = document.getElementById("email").value.trim();
  const password = document.getElementById("password").value;

  try {
    await signInWithEmailAndPassword(auth, email, password);
    // onAuthStateChanged will redirect
  } catch (err) {
    loginBtn.disabled = false;
    loginBtn.textContent = "Enter";
    errEl.textContent = friendlyError(err.code);
    errEl.classList.remove("hidden");
  }
});

function friendlyError(code) {
  switch (code) {
    case "auth/invalid-email":          return "That doesn't look like a valid email.";
    case "auth/user-not-found":         return "No account found with that email.";
    case "auth/wrong-password":         return "Incorrect password.";
    case "auth/invalid-credential":     return "Invalid email or password.";
    case "auth/too-many-requests":      return "Too many attempts. Try again later.";
    default:                            return "Login failed. Check your credentials.";
  }
}
