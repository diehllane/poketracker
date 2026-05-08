import { auth, db } from "./firebase-config.js";
import {
  onAuthStateChanged,
  signOut
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import {
  collection,
  addDoc,
  deleteDoc,
  doc,
  onSnapshot,
  query,
  orderBy,
  getDoc,
  setDoc,
  updateDoc,
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

let currentUser = null;
let currentRate = 15; // default kk per 1kk EXP
let unsubscribe = null;

// ─── Auth guard ───────────────────────────────────────────────────────────────
onAuthStateChanged(auth, async (user) => {
  if (!user) { window.location.href = "index.html"; return; }
  currentUser = user;

  const name = user.displayName || user.email.split("@")[0];
  document.getElementById("navUsername").textContent = name;

  await loadUserRate();
  listenToEntries();
});

document.getElementById("logoutBtn").addEventListener("click", async () => {
  if (unsubscribe) unsubscribe();
  await signOut(auth);
  window.location.href = "index.html";
});

// ─── Rate management ──────────────────────────────────────────────────────────
async function loadUserRate() {
  try {
    const snap = await getDoc(doc(db, "users", currentUser.uid));
    if (snap.exists() && snap.data().daycareRate) {
      currentRate = snap.data().daycareRate;
    }
  } catch {}
  document.getElementById("rateDisplay").textContent = currentRate + "kk";
  document.getElementById("rateInput").value = currentRate;
}

document.getElementById("editRateBtn").addEventListener("click", () => {
  document.getElementById("rateEditForm").classList.toggle("hidden");
  document.getElementById("rateInput").value = currentRate;
});

document.getElementById("cancelRateBtn").addEventListener("click", () => {
  document.getElementById("rateEditForm").classList.add("hidden");
});

document.getElementById("saveRateBtn").addEventListener("click", async () => {
  const val = parseFloat(document.getElementById("rateInput").value);
  if (!val || val <= 0) return;
  currentRate = val;
  document.getElementById("rateDisplay").textContent = currentRate + "kk";
  document.getElementById("rateEditForm").classList.add("hidden");

  // Persist to user profile
  try {
    await setDoc(doc(db, "users", currentUser.uid), { daycareRate: currentRate }, { merge: true });
  } catch {}
  renderEntries(cachedEntries);
});

// ─── Modal ────────────────────────────────────────────────────────────────────
const modal     = document.getElementById("addModal");
const addBtn    = document.getElementById("addEntryBtn");
const cancelBtn = document.getElementById("cancelModalBtn");

addBtn.addEventListener("click", () => {
  modal.classList.remove("hidden");
  document.getElementById("dc-price").value = "";
  document.getElementById("dc-exp").value   = "";
  document.getElementById("daycareForm").reset();
  // Set today as default date
  document.getElementById("dc-date").value = new Date().toISOString().split("T")[0];
});

cancelBtn.addEventListener("click", closeModal);
document.querySelector(".modal-backdrop").addEventListener("click", closeModal);

function closeModal() {
  modal.classList.add("hidden");
  document.getElementById("dcError").classList.add("hidden");
}

// ─── Auto-calculate price ─────────────────────────────────────────────────────
document.getElementById("dc-exp").addEventListener("input", (e) => {
  const exp = parseFloat(e.target.value);
  if (!isNaN(exp) && exp > 0) {
    const price = exp * currentRate;
    document.getElementById("dc-price").value = price.toLocaleString() + " kk";
  } else {
    document.getElementById("dc-price").value = "";
  }
});

// ─── Submit form ──────────────────────────────────────────────────────────────
document.getElementById("daycareForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const errEl = document.getElementById("dcError");
  errEl.classList.add("hidden");

  const username = document.getElementById("dc-username").value.trim();
  const discord  = document.getElementById("dc-discord").value.trim();
  const pokemon  = document.getElementById("dc-pokemon").value.trim();
  const exp      = parseFloat(document.getElementById("dc-exp").value);
  const date     = document.getElementById("dc-date").value;

  if (!username || !discord || !pokemon || !exp || !date) {
    errEl.textContent = "All fields are required.";
    errEl.classList.remove("hidden");
    return;
  }

  const price = exp * currentRate;

  try {
    await addDoc(collection(db, "users", currentUser.uid, "daycare"), {
      username,
      discord,
      pokemon,
      exp,
      date,
      price,
      rate: currentRate,
      createdAt: serverTimestamp()
    });
    closeModal();
  } catch (err) {
    errEl.textContent = "Failed to save: " + err.message;
    errEl.classList.remove("hidden");
  }
});

// ─── Live listener ────────────────────────────────────────────────────────────
let cachedEntries = [];

function listenToEntries() {
  const q = query(
    collection(db, "users", currentUser.uid, "daycare"),
    orderBy("date", "asc"),
    orderBy("createdAt", "asc")
  );

  unsubscribe = onSnapshot(q, (snap) => {
    cachedEntries = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    renderEntries(cachedEntries);
  }, (err) => {
    console.error("Daycare listener error:", err);
  });
}

// ─── Render ───────────────────────────────────────────────────────────────────
function renderEntries(entries) {
  const loading  = document.getElementById("loadingState");
  const empty    = document.getElementById("emptyState");
  const table    = document.getElementById("daycareTable");
  const tbody    = document.getElementById("daycareBody");

  loading.classList.add("hidden");

  if (entries.length === 0) {
    empty.classList.remove("hidden");
    table.classList.add("hidden");
    updateTotals(entries);
    return;
  }

  empty.classList.add("hidden");
  table.classList.remove("hidden");
  tbody.innerHTML = "";

  entries.forEach(entry => {
    // Recalculate price using current rate (live update)
    const price = entry.exp * currentRate;

    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${escHtml(entry.username)}</td>
      <td>${escHtml(entry.discord)}</td>
      <td>${escHtml(entry.pokemon)}</td>
      <td>${entry.exp.toLocaleString()}</td>
      <td>${entry.date}</td>
      <td class="price-cell">${price.toLocaleString()} kk</td>
      <td>
        <button class="btn-danger" data-id="${entry.id}" title="Delete entry">✕</button>
      </td>
    `;
    tbody.appendChild(tr);
  });

  // Delete handlers
  tbody.querySelectorAll(".btn-danger").forEach(btn => {
    btn.addEventListener("click", async () => {
      if (!confirm("Delete this daycare entry?")) return;
      try {
        await deleteDoc(doc(db, "users", currentUser.uid, "daycare", btn.dataset.id));
      } catch (err) { alert("Delete failed: " + err.message); }
    });
  });

  updateTotals(entries);
}

function updateTotals(entries) {
  const totalExp      = entries.reduce((sum, e) => sum + (e.exp || 0), 0);
  const totalEarnings = entries.reduce((sum, e) => sum + (e.exp * currentRate), 0);

  document.getElementById("totalEntries").textContent  = entries.length;
  document.getElementById("totalExp").textContent      = totalExp.toLocaleString();
  document.getElementById("totalEarnings").textContent = totalEarnings.toLocaleString();
}

function escHtml(str) {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
