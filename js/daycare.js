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
  serverTimestamp,
  writeBatch
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

// ─── EXP Table (cumulative EXP to reach each level, from ppobuddy.com) ─────────
const expTable = [
  0,0,
  139,298,477,677,899,1147,1425,1741,2104,
  2526,3022,3612,4319,5171,6200,7444,8946,10754,12924,
  15518,18604,22259,26567,31620,37519,44373,52301,61432,71905,
  83868,97481,112916,130355,149992,172035,196702,224227,254855,288846,
  326474,368028,413901,464232,519445,579891,645937,717967,796382,881601,
  974060,1074214,1182537,1299522,1425680,1561544,1707667,1864621,2033000,2213419,
  2406516,2612949,2833400,3068573,3319197,3586022,3869824,4171402,4491581,4831210,
  5191165,5572346,5975680,6402122,6852652,7328278,7830037,8358992,8916236,9502891,
  10120108,10769067,11450978,12167083,12918653,13706991,14533432,15399342,16306119,17255195,
  18248034,19286134,20371026,21504276,22687485,23922287,25210353,26553390,27953140,29411381
];

function toKk(exp) { return Math.round((exp / 1000000) * 100) / 100; }
function calcExpKk(start, finish) {
  if (!start || !finish || finish <= start || start < 1 || finish > 100) return 0;
  return toKk(expTable[finish] - expTable[start]);
}
function effectiveRate(entry) {
  return (entry.entryRate != null && entry.entryRate > 0)
    ? entry.entryRate
    : (entry.rate || currentRate);
}

// ─── State ────────────────────────────────────────────────────────────────────
let currentUser   = null;
let currentRate   = 15;
let unsubscribe   = null;
let cachedEntries = [];
let knownUsers    = {};  // { username: discordId }
let dragSrcId     = null;

// ─── Auth ─────────────────────────────────────────────────────────────────────
onAuthStateChanged(auth, async (user) => {
  if (!user) { window.location.href = "index.html"; return; }
  currentUser = user;
  document.getElementById("navUsername").textContent =
    user.displayName || user.email.split("@")[0];
  await loadUserRate();
  populateLevelSelects("dc-level-start", "dc-level-finish");
  populateLevelSelects("edit-level-start", "edit-level-finish");
  listenToKnownUsers();
  listenToEntries();
});

document.getElementById("logoutBtn").addEventListener("click", async () => {
  if (unsubscribe) unsubscribe();
  await signOut(auth);
  window.location.href = "index.html";
});

// ─── Level selects ────────────────────────────────────────────────────────────
function populateLevelSelects(startId, finishId) {
  const s = document.getElementById(startId);
  const f = document.getElementById(finishId);
  // Keep first placeholder option
  for (let i = 1; i <= 100; i++) {
    s.appendChild(new Option(`${i}`, i));
    f.appendChild(new Option(`${i}`, i));
  }
}

function wireRecalc(startId, finishId, rateId, expId, priceId) {
  const recalc = () => {
    const start   = parseInt(document.getElementById(startId).value);
    const finish  = parseInt(document.getElementById(finishId).value);
    const rateVal = parseFloat(document.getElementById(rateId).value);
    const rowRate = (!isNaN(rateVal) && rateVal > 0) ? rateVal : currentRate;
    const expKk   = calcExpKk(start, finish);
    document.getElementById(expId).value   = expKk ? expKk + " kk" : "";
    document.getElementById(priceId).value = expKk ? (Math.round(expKk * rowRate * 100) / 100) + " k" : "";
  };
  document.getElementById(startId).addEventListener("change", recalc);
  document.getElementById(finishId).addEventListener("change", recalc);
  document.getElementById(rateId).addEventListener("input", recalc);
}
wireRecalc("dc-level-start", "dc-level-finish", "dc-rate", "dc-exp", "dc-price");
wireRecalc("edit-level-start", "edit-level-finish", "edit-rate", "edit-exp", "edit-price");

// ─── Rate management ──────────────────────────────────────────────────────────
async function loadUserRate() {
  try {
    const snap = await getDoc(doc(db, "users", currentUser.uid));
    if (snap.exists() && snap.data().daycareRate) currentRate = snap.data().daycareRate;
  } catch {}
  document.getElementById("rateDisplay").textContent = currentRate + "k";
  document.getElementById("rateInput").value = currentRate;
}

document.getElementById("editRateBtn").addEventListener("click", () => {
  document.getElementById("rateEditForm").classList.toggle("hidden");
  document.getElementById("rateInput").value = currentRate;
});
document.getElementById("cancelRateBtn").addEventListener("click", () =>
  document.getElementById("rateEditForm").classList.add("hidden"));
document.getElementById("saveRateBtn").addEventListener("click", async () => {
  const val = parseFloat(document.getElementById("rateInput").value);
  if (!val || val <= 0) return;
  currentRate = val;
  document.getElementById("rateDisplay").textContent = currentRate + "k";
  document.getElementById("rateEditForm").classList.add("hidden");
  try { await setDoc(doc(db, "users", currentUser.uid), { daycareRate: currentRate }, { merge: true }); } catch {}
  renderEntries(cachedEntries);
});

// ─── Shared username list (Firestore top-level collection) ────────────────────
function listenToKnownUsers() {
  onSnapshot(collection(db, "knownUsers"), (snap) => {
    knownUsers = {};
    snap.docs.forEach(d => { knownUsers[d.id] = d.data().discordId || ""; });
  });
}

async function saveKnownUser(username, discordId) {
  if (!username) return;
  try {
    // Use username as document ID (sanitized)
    const key = username.toLowerCase().replace(/[^a-z0-9_\-]/g, "_");
    await setDoc(doc(db, "knownUsers", key), { username, discordId }, { merge: true });
  } catch {}
}

// ─── Username autocomplete ────────────────────────────────────────────────────
const usernameInput = document.getElementById("dc-username");
const suggestionBox = document.getElementById("dc-username-suggestions");

usernameInput.addEventListener("input", () => {
  const val = usernameInput.value.trim().toLowerCase();
  suggestionBox.innerHTML = "";
  if (!val || val.length < 1) { suggestionBox.classList.add("hidden"); return; }

  const matches = Object.values(knownUsers)
    .filter(u => u.username && u.username.toLowerCase().includes(val))
    .slice(0, 8);

  if (matches.length === 0) { suggestionBox.classList.add("hidden"); return; }

  matches.forEach(u => {
    const li = document.createElement("li");
    li.textContent = u.username;
    li.addEventListener("mousedown", (e) => {
      e.preventDefault();
      usernameInput.value = u.username;
      document.getElementById("dc-discord").value = u.discordId || "";
      suggestionBox.classList.add("hidden");
    });
    suggestionBox.appendChild(li);
  });
  suggestionBox.classList.remove("hidden");
});

usernameInput.addEventListener("blur", () => {
  setTimeout(() => suggestionBox.classList.add("hidden"), 150);
});

// ─── Add entry ────────────────────────────────────────────────────────────────
document.getElementById("addEntryBtn").addEventListener("click", async () => {
  const errEl = document.getElementById("dcError");
  errEl.classList.add("hidden");

  const username    = document.getElementById("dc-username").value.trim();
  const discord     = document.getElementById("dc-discord").value.trim();
  const pokemon     = document.getElementById("dc-pokemon").value.trim();
  const date        = document.getElementById("dc-date").value;
  const levelStart  = parseInt(document.getElementById("dc-level-start").value);
  const levelFinish = parseInt(document.getElementById("dc-level-finish").value);
  const rateRaw     = document.getElementById("dc-rate").value;

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

  const expKk      = calcExpKk(levelStart, levelFinish);
  const entryRate  = (rateRaw !== "" && parseFloat(rateRaw) > 0) ? parseFloat(rateRaw) : currentRate;
  const rateCustom = rateRaw !== "" && parseFloat(rateRaw) > 0;
  const price      = Math.round(expKk * entryRate * 100) / 100;
  const activeCount = cachedEntries.filter(e => !e.returned).length;

  try {
    await addDoc(collection(db, "users", currentUser.uid, "daycare"), {
      username, discord, pokemon, date,
      levelStart, levelFinish, expKk, price,
      entryRate, rateCustom,
      completed: false, returned: false,
      sortOrder: activeCount,
      createdAt: serverTimestamp()
    });
    await saveKnownUser(username, discord);
    clearAddRow();
  } catch (err) {
    errEl.textContent = "Failed to save: " + err.message;
    errEl.classList.remove("hidden");
  }
});

function clearAddRow() {
  ["dc-username","dc-discord","dc-pokemon","dc-date","dc-rate","dc-exp","dc-price"].forEach(id => {
    document.getElementById(id).value = "";
  });
  document.getElementById("dc-level-start").value  = "";
  document.getElementById("dc-level-finish").value = "";
}

// ─── Edit modal ───────────────────────────────────────────────────────────────
function openEditModal(entry) {
  document.getElementById("edit-id").value           = entry.id;
  document.getElementById("edit-username").value     = entry.username || "";
  document.getElementById("edit-discord").value      = entry.discord || "";
  document.getElementById("edit-pokemon").value      = entry.pokemon || "";
  document.getElementById("edit-date").value         = entry.date || "";
  document.getElementById("edit-level-start").value  = entry.levelStart || "";
  document.getElementById("edit-level-finish").value = entry.levelFinish || "";
  document.getElementById("edit-rate").value         = entry.entryRate || entry.rate || currentRate;
  // Trigger recalc
  const expKk = calcExpKk(entry.levelStart, entry.levelFinish);
  const rate  = entry.entryRate || entry.rate || currentRate;
  document.getElementById("edit-exp").value   = expKk ? expKk + " kk" : "";
  document.getElementById("edit-price").value = expKk ? (Math.round(expKk * rate * 100) / 100) + " k" : "";
  document.getElementById("editError").classList.add("hidden");
  document.getElementById("editModal").classList.remove("hidden");
}

document.getElementById("cancelEditBtn").addEventListener("click", () =>
  document.getElementById("editModal").classList.add("hidden"));
document.getElementById("editModal").querySelector(".modal-backdrop")
  .addEventListener("click", () => document.getElementById("editModal").classList.add("hidden"));

document.getElementById("saveEditBtn").addEventListener("click", async () => {
  const errEl = document.getElementById("editError");
  errEl.classList.add("hidden");

  const id          = document.getElementById("edit-id").value;
  const username    = document.getElementById("edit-username").value.trim();
  const discord     = document.getElementById("edit-discord").value.trim();
  const pokemon     = document.getElementById("edit-pokemon").value.trim();
  const date        = document.getElementById("edit-date").value;
  const levelStart  = parseInt(document.getElementById("edit-level-start").value);
  const levelFinish = parseInt(document.getElementById("edit-level-finish").value);
  const rateRaw     = parseFloat(document.getElementById("edit-rate").value);

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

  const expKk     = calcExpKk(levelStart, levelFinish);
  const entryRate = (!isNaN(rateRaw) && rateRaw > 0) ? rateRaw : currentRate;
  const price     = Math.round(expKk * entryRate * 100) / 100;

  try {
    await updateDoc(doc(db, "users", currentUser.uid, "daycare", id), {
      username, discord, pokemon, date,
      levelStart, levelFinish, expKk, price,
      entryRate, rateCustom: !isNaN(rateRaw) && rateRaw > 0
    });
    await saveKnownUser(username, discord);
    document.getElementById("editModal").classList.add("hidden");
  } catch (err) {
    errEl.textContent = "Failed to save: " + err.message;
    errEl.classList.remove("hidden");
  }
});

// ─── Live listener ────────────────────────────────────────────────────────────
function listenToEntries() {
  const q = query(
    collection(db, "users", currentUser.uid, "daycare"),
    orderBy("createdAt", "asc")
  );
  unsubscribe = onSnapshot(q, (snap) => {
    cachedEntries = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    renderEntries(cachedEntries);
  }, (err) => {
    console.error("Firestore error:", err.code, err.message);
    document.getElementById("loadingState").textContent = "Error: " + err.message;
  });
}

// ─── Render ───────────────────────────────────────────────────────────────────
function renderEntries(entries) {
  const loading = document.getElementById("loadingState");
  const empty   = document.getElementById("emptyState");
  const table   = document.getElementById("daycareTable");
  const tbody   = document.getElementById("daycareBody");

  loading.classList.add("hidden");
  table.classList.remove("hidden");
  empty.classList.toggle("hidden", entries.length > 0);
  tbody.innerHTML = "";

  const active   = entries.filter(e => !e.returned).sort((a, b) =>
    ((a.sortOrder ?? 99999) - (b.sortOrder ?? 99999)));
  const returned = entries.filter(e => e.returned).sort((a, b) =>
    (a.date || "").localeCompare(b.date || ""));
  const sorted = [...active, ...returned];

  sorted.forEach(entry => {
    const rate     = effectiveRate(entry);
    const price    = Math.round((entry.expKk || 0) * rate * 100) / 100;
    const isActive = !entry.returned;
    const tr       = document.createElement("tr");

    if (entry.returned) tr.classList.add("returned");
    if (isActive) { tr.draggable = true; tr.dataset.id = entry.id; tr.classList.add("draggable-row"); }

    tr.innerHTML = `
      <td class="drag-handle ${isActive ? "" : "no-drag"}">${isActive ? "⠿" : ""}</td>
      <td>${escHtml(entry.username || "")}</td>
      <td class="discord-id-cell" title="${escHtml(entry.discord || "")}">${escHtml(entry.discord || "")}</td>
      <td>${escHtml(entry.pokemon || "")}</td>
      <td>${entry.levelStart || "?"} → ${entry.levelFinish || "?"}</td>
      <td>${entry.expKk || 0}</td>
      <td>${entry.date || ""}</td>
      <td class="${entry.rateCustom ? "rate-custom" : "rate-default"}">${rate} k</td>
      <td class="price-cell">${price.toLocaleString()} k</td>
      <td class="no-strike">
        <input type="checkbox" class="complete-check" data-id="${entry.id}"
          data-username="${escHtml(entry.username||"")}"
          data-discord="${escHtml(entry.discord||"")}"
          data-pokemon="${escHtml(entry.pokemon||"")}"
          data-level-start="${entry.levelStart||""}"
          data-level-finish="${entry.levelFinish||""}"
          data-exp="${entry.expKk||0}"
          data-rate="${rate}"
          data-price="${price}"
          ${entry.completed === true ? "checked" : ""}
          title="Mark as complete" />
      </td>
      <td class="no-strike">
        <button class="btn-notify ${entry.completed === true ? "" : "hidden"}"
          data-discord="${escHtml(entry.discord||"")}"
          data-username="${escHtml(entry.username||"")}"
          data-pokemon="${escHtml(entry.pokemon||"")}"
          data-level-start="${entry.levelStart||""}"
          data-level-finish="${entry.levelFinish||""}"
          data-exp="${entry.expKk||0}"
          data-rate="${rate}"
          data-price="${price}"
          title="Send Discord notification">📨</button>
      </td>
      <td class="no-strike">
        <input type="checkbox" class="return-check" data-id="${entry.id}"
          ${entry.returned ? "checked" : ""}
          title="${entry.returned ? "Mark as not returned" : "Mark as returned"}" />
      </td>
      <td class="no-strike">
        <button class="btn-edit" data-id="${entry.id}" title="Edit entry">✏️</button>
        <button class="btn-danger" data-id="${entry.id}" title="Delete entry">✕</button>
      </td>
    `;
    tbody.appendChild(tr);
  });

  setupDragAndDrop();

  tbody.querySelectorAll(".complete-check").forEach(cb => {
    cb.addEventListener("change", async () => {
      try {
        await updateDoc(doc(db, "users", currentUser.uid, "daycare", cb.dataset.id), { completed: cb.checked });
      } catch (err) { alert("Update failed: " + err.message); cb.checked = !cb.checked; }
    });
  });

  tbody.querySelectorAll(".btn-notify").forEach(btn => {
    btn.addEventListener("click", () => sendDiscordNotification(btn.dataset));
  });

  tbody.querySelectorAll(".return-check").forEach(cb => {
    cb.addEventListener("change", async () => {
      try {
        const updates = { returned: cb.checked };
        updates.sortOrder = cb.checked ? 9999 : cachedEntries.filter(e => !e.returned).length;
        await updateDoc(doc(db, "users", currentUser.uid, "daycare", cb.dataset.id), updates);
      } catch (err) { alert("Update failed: " + err.message); cb.checked = !cb.checked; }
    });
  });

  tbody.querySelectorAll(".btn-edit").forEach(btn => {
    btn.addEventListener("click", () => {
      const entry = cachedEntries.find(e => e.id === btn.dataset.id);
      if (entry) openEditModal(entry);
    });
  });

  tbody.querySelectorAll(".btn-danger").forEach(btn => {
    btn.addEventListener("click", async () => {
      if (!confirm("Delete this daycare entry?")) return;
      try { await deleteDoc(doc(db, "users", currentUser.uid, "daycare", btn.dataset.id)); }
      catch (err) { alert("Delete failed: " + err.message); }
    });
  });

  updateTotals(entries);
}

// ─── Drag and drop ────────────────────────────────────────────────────────────
function setupDragAndDrop() {
  const tbody = document.getElementById("daycareBody");
  const rows  = [...tbody.querySelectorAll(".draggable-row")];

  rows.forEach(row => {
    row.addEventListener("dragstart", e => {
      dragSrcId = row.dataset.id;
      row.classList.add("dragging");
      e.dataTransfer.effectAllowed = "move";
    });
    row.addEventListener("dragend", () => {
      row.classList.remove("dragging");
      tbody.querySelectorAll(".drag-over").forEach(r => r.classList.remove("drag-over"));
    });
    row.addEventListener("dragover", e => {
      e.preventDefault();
      tbody.querySelectorAll(".drag-over").forEach(r => r.classList.remove("drag-over"));
      if (row.dataset.id !== dragSrcId) row.classList.add("drag-over");
    });
    row.addEventListener("drop", async e => {
      e.preventDefault();
      const targetId = row.dataset.id;
      if (!dragSrcId || dragSrcId === targetId) return;
      const ids    = [...tbody.querySelectorAll(".draggable-row")].map(r => r.dataset.id);
      const srcIdx = ids.indexOf(dragSrcId);
      const tgtIdx = ids.indexOf(targetId);
      ids.splice(srcIdx, 1);
      ids.splice(tgtIdx, 0, dragSrcId);
      try {
        const batch = writeBatch(db);
        ids.forEach((id, i) => batch.update(doc(db, "users", currentUser.uid, "daycare", id), { sortOrder: i }));
        await batch.commit();
      } catch (err) { alert("Reorder failed: " + err.message); }
    });
  });
}

// ─── Totals ───────────────────────────────────────────────────────────────────
function updateTotals(entries) {
  const active        = entries.filter(e => !e.returned);
  const totalExp      = active.reduce((sum, e) => sum + (e.expKk || 0), 0);
  const totalEarnings = active.reduce((sum, e) => sum + ((e.expKk || 0) * effectiveRate(e)), 0);
  document.getElementById("totalEntries").textContent  = active.length;
  document.getElementById("totalExp").textContent      = Math.round(totalExp * 100) / 100;
  document.getElementById("totalEarnings").textContent = Math.round(totalEarnings).toLocaleString();
}

// ─── Discord DM Notification ──────────────────────────────────────────────────
async function sendDiscordNotification(data) {
  const message = [
    "✅ **Daycare Complete!**",
    "",
    `**Trainer:** ${data.username}`,
    `**Discord ID:** ${data.discord}`,
    `**Pokémon:** ${data.pokemon}`,
    `**Levels:** ${data["level-start"]} → ${data["level-finish"]}`,
    `**Total EXP:** ${data.exp} kk`,
    `**Rate:** ${data.rate} k per 1kk EXP`,
    `**Final Price:** ${Number(data.price).toLocaleString()} k`,
  ].join("\n");

  try { await navigator.clipboard.writeText(message); } catch {}

  showNotifyModal(message, data.discord);
}

function showNotifyModal(message, discordId) {
  document.getElementById("notifyModal")?.remove();
  const modal = document.createElement("div");
  modal.id = "notifyModal";
  modal.className = "modal";

  // Build Open Discord button — deep link to DM if numeric ID present, else @me
  const isNumericId = /^\d{10,}$/.test((discordId || "").trim());
  const discordUrl  = isNumericId
    ? `https://discord.com/users/${discordId.trim()}`
    : "https://discord.com/channels/@me";
  const appUrl      = isNumericId
    ? `discord://discord.com/users/${discordId.trim()}`
    : "discord://";

  modal.innerHTML = `
    <div class="modal-backdrop"></div>
    <div class="modal-card" style="max-width:520px">
      <h3>📨 Notify Trainer</h3>
      <p style="font-size:0.85rem;color:var(--text-muted);margin-bottom:12px;">
        Message copied to clipboard. Click <strong>Open Discord</strong> to open the DM,
        then paste to send.
      </p>
      <textarea class="notify-textarea" readonly>${escHtml(message)}</textarea>
      <div class="success-msg" style="margin:8px 0;" id="copyConfirm">✓ Copied to clipboard!</div>
      <div class="modal-actions">
        <button id="openDiscordBtn" class="btn-primary">Open Discord</button>
        <button id="copyAgainBtn" class="btn-secondary">Copy Again</button>
        <button id="closeNotifyBtn" class="btn-ghost">Close</button>
      </div>
    </div>
  `;
  document.body.appendChild(modal);

  document.getElementById("openDiscordBtn").addEventListener("click", () => {
    // Try app deep link; fall back to web after 1.5s if app doesn't respond
    const iframe = document.createElement("iframe");
    iframe.style.display = "none";
    iframe.src = appUrl;
    document.body.appendChild(iframe);
    setTimeout(() => {
      document.body.removeChild(iframe);
      if (!document.hidden) window.open(discordUrl, "_blank");
    }, 1500);
  });

  document.getElementById("copyAgainBtn").addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(message);
      document.getElementById("copyConfirm").textContent = "✓ Copied again!";
    } catch {
      document.querySelector("#notifyModal .notify-textarea").select();
      document.execCommand("copy");
    }
  });

  document.getElementById("closeNotifyBtn").addEventListener("click", () => modal.remove());
  modal.querySelector(".modal-backdrop").addEventListener("click", () => modal.remove());
}

function escHtml(str) {
  return String(str)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;")
    .replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
