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
  serverTimestamp,
  updateDoc
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

// ─── EXP Table (cumulative EXP to reach each level, from ppobuddy.com) ─────────
// Index = level. expTable[n] = total EXP needed to BE at level n from level 1.
// EXP to go from level A to B = expTable[B] - expTable[A]
const expTable = [
  0,        // L0 placeholder
  0,        // L1 (start)
  139,
  298,
  477,
  677,
  899,
  1147,
  1425,
  1741,
  2104,
  2526,
  3022,
  3612,
  4319,
  5171,
  6200,
  7444,
  8946,
  10754,
  12924,
  15518,
  18604,
  22259,
  26567,
  31620,
  37519,
  44373,
  52301,
  61432,
  71905,
  83868,
  97481,
  112916,
  130355,
  149992,
  172035,
  196702,
  224227,
  254855,
  288846,
  326474,
  368028,
  413901,
  464232,
  519445,
  579891,
  645937,
  717967,
  796382,
  881601,
  974060,
  1074214,
  1182537,
  1299522,
  1425680,
  1561544,
  1707667,
  1864621,
  2033000,
  2213419,
  2406516,
  2612949,
  2833400,
  3068573,
  3319197,
  3586022,
  3869824,
  4171402,
  4491581,
  4831210,
  5191165,
  5572346,
  5975680,
  6402122,
  6852652,
  7328278,
  7830037,
  8358992,
  8916236,
  9502891,
  10120108,
  10769067,
  11450978,
  12167083,
  12918653,
  13706991,
  14533432,
  15399342,
  16306119,
  17255195,
  18248034,
  19286134,
  20371026,
  21504276,
  22687485,
  23922287,
  25210353,
  26553390,
  27953140,
  29411381   // L100
];

// Convert raw EXP to kk (millions), rounded to 2 decimal places
function toKk(exp) {
  return Math.round((exp / 1000000) * 100) / 100;
}

// EXP needed to go from levelStart to levelFinish, in kk
function calcExpKk(start, finish) {
  if (finish <= start || start < 1 || finish > 100) return 0;
  return toKk(expTable[finish] - expTable[start]);
}

// ─── State ────────────────────────────────────────────────────────────────────
let currentUser = null;
let currentRate = 15;
let unsubscribe = null;
let cachedEntries = [];

// ─── Auth guard ───────────────────────────────────────────────────────────────
onAuthStateChanged(auth, async (user) => {
  if (!user) { window.location.href = "index.html"; return; }
  currentUser = user;
  document.getElementById("navUsername").textContent =
    user.displayName || user.email.split("@")[0];

  await loadUserRate();
  populateLevelSelects();
  listenToEntries();
});

document.getElementById("logoutBtn").addEventListener("click", async () => {
  if (unsubscribe) unsubscribe();
  await signOut(auth);
  window.location.href = "index.html";
});

// ─── Level selects ────────────────────────────────────────────────────────────
function populateLevelSelects() {
  const startSel  = document.getElementById("dc-level-start");
  const finishSel = document.getElementById("dc-level-finish");

  for (let i = 1; i <= 100; i++) {
    const o1 = new Option(`Level ${i}`, i);
    const o2 = new Option(`Level ${i}`, i);
    startSel.appendChild(o1);
    finishSel.appendChild(o2);
  }
}

function recalcFromLevels() {
  const start  = parseInt(document.getElementById("dc-level-start").value);
  const finish = parseInt(document.getElementById("dc-level-finish").value);

  if (start && finish && finish > start) {
    const expKk = calcExpKk(start, finish);
    const price = Math.round(expKk * currentRate * 100) / 100;
    document.getElementById("dc-exp").value   = expKk + " kk";
    document.getElementById("dc-price").value = price.toLocaleString() + " k";
  } else {
    document.getElementById("dc-exp").value   = "";
    document.getElementById("dc-price").value = "";
  }
}

document.getElementById("dc-level-start").addEventListener("change", recalcFromLevels);
document.getElementById("dc-level-finish").addEventListener("change", recalcFromLevels);

// ─── Rate management ──────────────────────────────────────────────────────────
async function loadUserRate() {
  try {
    const snap = await getDoc(doc(db, "users", currentUser.uid));
    if (snap.exists() && snap.data().daycareRate) {
      currentRate = snap.data().daycareRate;
    }
  } catch {}
  document.getElementById("rateDisplay").textContent = currentRate + "k";
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
  document.getElementById("rateDisplay").textContent = currentRate + "k";
  document.getElementById("rateEditForm").classList.add("hidden");
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
  document.getElementById("daycareForm").reset();
  document.getElementById("dc-date").value = new Date().toISOString().split("T")[0];
  document.getElementById("dc-exp").value   = "";
  document.getElementById("dc-price").value = "";
});
cancelBtn.addEventListener("click", closeModal);
document.querySelector(".modal-backdrop").addEventListener("click", closeModal);

function closeModal() {
  modal.classList.add("hidden");
  document.getElementById("dcError").classList.add("hidden");
}

// ─── Submit ───────────────────────────────────────────────────────────────────
document.getElementById("daycareForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const errEl = document.getElementById("dcError");
  errEl.classList.add("hidden");

  const username    = document.getElementById("dc-username").value.trim();
  const discord     = document.getElementById("dc-discord").value.trim();
  const pokemon     = document.getElementById("dc-pokemon").value.trim();
  const date        = document.getElementById("dc-date").value;
  const levelStart  = parseInt(document.getElementById("dc-level-start").value);
  const levelFinish = parseInt(document.getElementById("dc-level-finish").value);

  if (!username || !discord || !pokemon || !date || !levelStart || !levelFinish) {
    errEl.textContent = "All fields are required.";
    errEl.classList.remove("hidden");
    return;
  }
  if (levelFinish <= levelStart) {
    errEl.textContent = "Level Finish must be greater than Level Start.";
    errEl.classList.remove("hidden");
    return;
  }

  const expKk = calcExpKk(levelStart, levelFinish);
  const price = Math.round(expKk * currentRate * 100) / 100;

  try {
    await addDoc(collection(db, "users", currentUser.uid, "daycare"), {
      username, discord, pokemon, date,
      levelStart, levelFinish,
      expKk, price,
      rate: currentRate,
      returned: false,
      createdAt: serverTimestamp()
    });
    closeModal();
  } catch (err) {
    errEl.textContent = "Failed to save: " + err.message;
    errEl.classList.remove("hidden");
  }
});

// ─── Live listener ────────────────────────────────────────────────────────────
function listenToEntries() {
  const q = query(
    collection(db, "users", currentUser.uid, "daycare"),
    orderBy("date", "asc"),
    orderBy("createdAt", "asc")
  );

  unsubscribe = onSnapshot(q, (snap) => {
    cachedEntries = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    renderEntries(cachedEntries);
  });
}

// ─── Render ───────────────────────────────────────────────────────────────────
function renderEntries(entries) {
  const loading = document.getElementById("loadingState");
  const empty   = document.getElementById("emptyState");
  const table   = document.getElementById("daycareTable");
  const tbody   = document.getElementById("daycareBody");

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

  // Active entries first (oldest date), then returned entries
  const active   = entries.filter(e => !e.returned).sort((a, b) => a.date.localeCompare(b.date));
  const returned = entries.filter(e => e.returned).sort((a, b) => a.date.localeCompare(b.date));
  const sorted   = [...active, ...returned];

  sorted.forEach(entry => {
    const price = Math.round(entry.expKk * currentRate * 100) / 100;
    const tr = document.createElement("tr");
    if (entry.returned) tr.classList.add("returned");
    tr.innerHTML = `
      <td>${escHtml(entry.username)}</td>
      <td>${escHtml(entry.discord)}</td>
      <td>${escHtml(entry.pokemon)}</td>
      <td>${entry.levelStart} → ${entry.levelFinish}</td>
      <td>${entry.expKk}</td>
      <td>${entry.date}</td>
      <td class="price-cell">${price.toLocaleString()} k</td>
      <td class="no-strike">
        <input type="checkbox" class="return-check" data-id="${entry.id}"
          ${entry.returned ? "checked" : ""}
          title="${entry.returned ? "Mark as not returned" : "Mark as returned"}" />
      </td>
      <td class="no-strike">
        <button class="btn-danger" data-id="${entry.id}" title="Delete">✕</button>
      </td>
    `;
    tbody.appendChild(tr);
  });

  // Return checkbox handler
  tbody.querySelectorAll(".return-check").forEach(cb => {
    cb.addEventListener("change", async () => {
      try {
        await updateDoc(doc(db, "users", currentUser.uid, "daycare", cb.dataset.id), {
          returned: cb.checked
        });
      } catch (err) {
        alert("Update failed: " + err.message);
        cb.checked = !cb.checked;
      }
    });
  });

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
  const totalExp      = entries.reduce((sum, e) => sum + (e.expKk || 0), 0);
  const totalEarnings = entries.reduce((sum, e) => sum + (e.expKk * currentRate), 0);
  document.getElementById("totalEntries").textContent  = entries.length;
  document.getElementById("totalExp").textContent      = Math.round(totalExp * 100) / 100;
  document.getElementById("totalEarnings").textContent = Math.round(totalEarnings).toLocaleString();
}

function escHtml(str) {
  return String(str)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;")
    .replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
