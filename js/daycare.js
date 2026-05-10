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
  0,        // L0 placeholder
  0,        // L1 (start)
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
  if (finish <= start || start < 1 || finish > 100) return 0;
  return toKk(expTable[finish] - expTable[start]);
}
function calcPrice(expKk) { return Math.round(expKk * currentRate * 100) / 100; }

// ─── State ────────────────────────────────────────────────────────────────────
let currentUser   = null;
let currentRate   = 15;
let unsubscribe   = null;
let cachedEntries = [];
let dragSrcId     = null;

// ─── Auth guard ───────────────────────────────────────────────────────────────
onAuthStateChanged(auth, async (user) => {
  if (!user) { window.location.href = "index.html"; return; }
  currentUser = user;
  document.getElementById("navUsername").textContent =
    user.displayName || user.email.split("@")[0];

  console.log("Auth OK, user:", currentUser.uid);
  await loadUserRate();
  console.log("Rate loaded:", currentRate);
  populateLevelSelects();
  console.log("Levels populated, calling listenToEntries...");
  listenToEntries();
  console.log("listenToEntries called");
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
    startSel.appendChild(new Option(`${i}`, i));
    finishSel.appendChild(new Option(`${i}`, i));
  }
}

function recalcAddRow() {
  const start    = parseInt(document.getElementById("dc-level-start").value);
  const finish   = parseInt(document.getElementById("dc-level-finish").value);
  const rateVal  = parseFloat(document.getElementById("dc-rate").value);
  const rowRate  = (!isNaN(rateVal) && rateVal > 0) ? rateVal : currentRate;

  if (start && finish && finish > start) {
    const expKk = calcExpKk(start, finish);
    document.getElementById("dc-exp").value   = expKk + " kk";
    document.getElementById("dc-price").value = Math.round(expKk * rowRate * 100) / 100 + " k";
  } else {
    document.getElementById("dc-exp").value   = "";
    document.getElementById("dc-price").value = "";
  }
}

document.getElementById("dc-level-start").addEventListener("change", recalcAddRow);
document.getElementById("dc-level-finish").addEventListener("change", recalcAddRow);
document.getElementById("dc-rate").addEventListener("input", recalcAddRow);

// ─── Rate management ──────────────────────────────────────────────────────────
async function loadUserRate() {
  try {
    const snap = await getDoc(doc(db, "users", currentUser.uid));
    if (snap.exists()) {
      if (snap.data().daycareRate) currentRate = snap.data().daycareRate;
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

// ─── Add entry (inline row) ───────────────────────────────────────────────────
document.getElementById("addEntryBtn").addEventListener("click", async () => {
  const errEl = document.getElementById("dcError");
  errEl.classList.add("hidden");

  const username    = document.getElementById("dc-username").value.trim();
  const discord     = document.getElementById("dc-discord").value.trim();
  const pokemon     = document.getElementById("dc-pokemon").value.trim();
  const date        = document.getElementById("dc-date").value;
  const levelStart  = parseInt(document.getElementById("dc-level-start").value);
  const levelFinish = parseInt(document.getElementById("dc-level-finish").value);
  const rateRaw  = document.getElementById("dc-rate").value;

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

  const expKk       = calcExpKk(levelStart, levelFinish);
  const entryRate   = (rateRaw !== "" && parseFloat(rateRaw) > 0) ? parseFloat(rateRaw) : currentRate;
  const rateCustom  = rateRaw !== "" && parseFloat(rateRaw) > 0;
  const price       = Math.round(expKk * entryRate * 100) / 100;

  // Sort order: place at end of active entries
  const activeCount = cachedEntries.filter(e => !e.returned).length;

  try {
    await addDoc(collection(db, "users", currentUser.uid, "daycare"), {
      username, discord, pokemon, date,
      levelStart, levelFinish,
      expKk, price,
      entryRate, rateCustom,
      completed: false,
      returned: false,
      sortOrder: activeCount,
      createdAt: serverTimestamp()
    });
    clearAddRow();
  } catch (err) {
    errEl.textContent = "Failed to save: " + err.message;
    errEl.classList.remove("hidden");
  }
});

function clearAddRow() {
  document.getElementById("dc-username").value    = "";
  document.getElementById("dc-discord").value     = "";
  document.getElementById("dc-pokemon").value     = "";
  document.getElementById("dc-date").value        = "";
  document.getElementById("dc-level-start").value = "";
  document.getElementById("dc-level-finish").value= "";
  document.getElementById("dc-rate").value        = "";
  document.getElementById("dc-exp").value         = "";
  document.getElementById("dc-price").value       = "";
}

// ─── Live listener ────────────────────────────────────────────────────────────
function listenToEntries() {
  // Order by createdAt only — sortOrder is applied client-side
  // This avoids composite index issues and handles entries without sortOrder
  const q = query(
    collection(db, "users", currentUser.uid, "daycare"),
    orderBy("createdAt", "asc")
  );

  console.log("Attaching snapshot listener...");
  unsubscribe = onSnapshot(q, (snap) => {
    console.log("Snapshot fired, docs:", snap.docs.length);
    try {
      cachedEntries = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      console.log("cachedEntries built:", cachedEntries.length);
      renderEntries(cachedEntries);
      console.log("renderEntries returned OK");
    } catch(err) {
      console.error("CRASH in snapshot handler:", err);
      document.getElementById("loadingState").textContent = "Crash: " + err.message;
    }
  }, (err) => {
    console.error("Firestore listener error:", err.code, err.message);
    document.getElementById("loadingState").textContent = "Firestore error: " + err.message;
  });
}

// ─── Render ───────────────────────────────────────────────────────────────────
function renderEntries(entries) {
  try { _renderEntries(entries); } catch(err) {
    console.error("renderEntries crashed:", err);
    document.getElementById("loadingState").textContent = "Render error: " + err.message;
  }
}
function _renderEntries(entries) {
  const empty = document.getElementById("emptyState");
  const tbody = document.getElementById("daycareBody");

  // Active first by sortOrder (old entries without it sort to end), then returned
  const active   = entries.filter(e => !e.returned).sort((a, b) => {
    const sa = (a.sortOrder !== undefined && a.sortOrder !== null) ? a.sortOrder : 99999;
    const sb = (b.sortOrder !== undefined && b.sortOrder !== null) ? b.sortOrder : 99999;
    return sa - sb;
  });
  const returned = entries.filter(e => e.returned).sort((a, b) => (a.date || "").localeCompare(b.date || ""));
  const sorted   = [...active, ...returned];

  document.getElementById("loadingState").classList.add("hidden");
  document.getElementById("daycareTable").classList.remove("hidden");
  empty.classList.toggle("hidden", entries.length > 0);
  tbody.innerHTML = "";

  sorted.forEach((entry, idx) => {
    const entryRate = (entry.entryRate != null && entry.entryRate > 0) ? entry.entryRate : (entry.rate || currentRate);
    const price     = Math.round(entry.expKk * entryRate * 100) / 100;
    const isActive = !entry.returned;
    const tr       = document.createElement("tr");

    if (entry.returned) tr.classList.add("returned");
    if (isActive) {
      tr.draggable = true;
      tr.dataset.id = entry.id;
      tr.classList.add("draggable-row");
    }

    tr.innerHTML = `
      <td class="drag-handle ${isActive ? "" : "no-drag"}">${isActive ? "⠿" : ""}</td>
      <td>${escHtml(entry.username)}</td>
      <td>${escHtml(entry.discord)}</td>
      <td>${escHtml(entry.pokemon)}</td>
      <td>${entry.levelStart} → ${entry.levelFinish}</td>
      <td>${entry.expKk}</td>
      <td>${entry.date}</td>
      <td class="${entry.rateCustom ? "rate-custom" : "rate-default"}">${entryRate} k</td>
      <td class="price-cell">${price.toLocaleString()} k</td>
      <td class="no-strike">
        <input type="checkbox" class="complete-check" data-id="${entry.id}"
          data-username="${escHtml(entry.username)}"
          data-discord="${escHtml(entry.discord)}"
          data-pokemon="${escHtml(entry.pokemon)}"
          data-level-start="${entry.levelStart}"
          data-level-finish="${entry.levelFinish}"
          data-exp="${entry.expKk}"
          data-rate="${entryRate}"
          data-price="${price}"
          ${entry.completed === true ? "checked" : ""}
          title="Mark as complete" />
      </td>
      <td class="no-strike">
        <button class="btn-notify ${entry.completed === true ? "" : "hidden"}" data-id="${entry.id}"
          data-username="${escHtml(entry.username)}"
          data-discord="${escHtml(entry.discord)}"
          data-pokemon="${escHtml(entry.pokemon)}"
          data-level-start="${entry.levelStart}"
          data-level-finish="${entry.levelFinish}"
          data-exp="${entry.expKk}"
          data-rate="${entryRate}"
          data-price="${price}"
          title="Send Discord notification">📨</button>
      </td>
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

  // Drag-and-drop
  setupDragAndDrop();

  // Complete checkbox
  tbody.querySelectorAll(".complete-check").forEach(cb => {
    cb.addEventListener("change", async () => {
      try {
        await updateDoc(doc(db, "users", currentUser.uid, "daycare", cb.dataset.id), {
          completed: cb.checked
        });
      } catch (err) {
        alert("Update failed: " + err.message);
        cb.checked = !cb.checked;
      }
    });
  });

  // Notify button
  tbody.querySelectorAll(".btn-notify").forEach(btn => {
    btn.addEventListener("click", () => sendDiscordNotification(btn.dataset));
  });

  // Return checkbox
  tbody.querySelectorAll(".return-check").forEach(cb => {
    cb.addEventListener("change", async () => {
      try {
        // If marking returned, clear sortOrder; if unreturning, assign to end
        const updates = { returned: cb.checked };
        if (cb.checked) {
          updates.sortOrder = 9999;
        } else {
          const activeCount = cachedEntries.filter(e => !e.returned).length;
          updates.sortOrder = activeCount;
        }
        await updateDoc(doc(db, "users", currentUser.uid, "daycare", cb.dataset.id), updates);
      } catch (err) {
        alert("Update failed: " + err.message);
        cb.checked = !cb.checked;
      }
    });
  });

  // Delete
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
      e.dataTransfer.dropEffect = "move";
      tbody.querySelectorAll(".drag-over").forEach(r => r.classList.remove("drag-over"));
      if (row.dataset.id !== dragSrcId) row.classList.add("drag-over");
    });
    row.addEventListener("drop", async e => {
      e.preventDefault();
      const targetId = row.dataset.id;
      if (!dragSrcId || dragSrcId === targetId) return;

      // Rebuild order based on current DOM order after drop
      const activeRows = [...tbody.querySelectorAll(".draggable-row")];
      const ids        = activeRows.map(r => r.dataset.id);
      const srcIdx     = ids.indexOf(dragSrcId);
      const tgtIdx     = ids.indexOf(targetId);

      // Reorder array
      ids.splice(srcIdx, 1);
      ids.splice(tgtIdx, 0, dragSrcId);

      // Write new sortOrder values to Firestore in a batch
      try {
        const batch = writeBatch(db);
        ids.forEach((id, i) => {
          batch.update(doc(db, "users", currentUser.uid, "daycare", id), { sortOrder: i });
        });
        await batch.commit();
      } catch (err) { alert("Reorder failed: " + err.message); }
    });
  });
}

// ─── Totals ───────────────────────────────────────────────────────────────────
function updateTotals(entries) {
  const active        = entries.filter(e => !e.returned);
  const totalExp      = active.reduce((sum, e) => sum + (e.expKk || 0), 0);
  const totalEarnings = active.reduce((sum, e) => sum + (e.expKk * ((e.entryRate != null && e.entryRate > 0) ? e.entryRate : (e.rate || currentRate))), 0);
  document.getElementById("totalEntries").textContent  = active.length;
  document.getElementById("totalExp").textContent      = Math.round(totalExp * 100) / 100;
  document.getElementById("totalEarnings").textContent = Math.round(totalEarnings).toLocaleString();
}

// ─── Discord DM Notification ─────────────────────────────────────────────────
async function sendDiscordNotification(data) {
  const message = [
    "✅ **Daycare Complete!**",
    "",
    `**Trainer:** ${data.username}`,
    `**Discord:** ${data.discord}`,
    `**Pokémon:** ${data.pokemon}`,
    `**Levels:** ${data["level-start"]} → ${data["level-finish"]}`,
    `**Total EXP:** ${data.exp} kk`,
    `**Rate:** ${data.rate} k per 1kk EXP`,
    `**Final Price:** ${Number(data.price).toLocaleString()} k`,
  ].join("\n");

  // Copy message to clipboard
  try {
    await navigator.clipboard.writeText(message);
  } catch (err) {
    // Clipboard API not available (some mobile browsers) — skip silently
    console.warn("Clipboard write failed:", err);
  }

  // Show a modal with the message and open Discord
  showNotifyModal(message, data.discord);
}

function showNotifyModal(message, discordName) {
  // Remove any existing modal
  document.getElementById("notifyModal")?.remove();

  const modal = document.createElement("div");
  modal.id = "notifyModal";
  modal.className = "modal";
  modal.innerHTML = `
    <div class="modal-backdrop"></div>
    <div class="modal-card" style="max-width:520px">
      <h3>📨 Send to ${escHtml(discordName)}</h3>
      <p style="font-size:0.85rem;color:var(--text-muted);margin-bottom:12px;">
        Message copied to clipboard. Open Discord, find <strong>${escHtml(discordName)}</strong>,
        and paste to send.
      </p>
      <textarea id="notifyText" class="notify-textarea" readonly>${escHtml(message)}</textarea>
      <div id="copyConfirm" class="success-msg" style="margin:8px 0;">✓ Copied to clipboard!</div>
      <div class="modal-actions">
        <button id="openDiscordBtn" class="btn-primary">Open Discord</button>
        <button id="copyAgainBtn" class="btn-secondary">Copy Again</button>
        <button id="closeNotifyBtn" class="btn-ghost">Close</button>
      </div>
    </div>
  `;
  document.body.appendChild(modal);

  // Open Discord — tries app deep link, falls back to web
  document.getElementById("openDiscordBtn").addEventListener("click", () => {
    // discord:// deep link works on Windows, macOS, iOS, Android if app is installed
    // Falls back to browser after 1.5s if app doesn't open
    const appLink = "discord://";
    const webLink = "https://discord.com/channels/@me";

    const iframe = document.createElement("iframe");
    iframe.style.display = "none";
    iframe.src = appLink;
    document.body.appendChild(iframe);

    setTimeout(() => {
      document.body.removeChild(iframe);
      // Only open web fallback if page is still visible (app didn't take over)
      if (!document.hidden) window.open(webLink, "_blank");
    }, 1500);
  });

  // Copy again button
  document.getElementById("copyAgainBtn").addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(message);
      document.getElementById("copyConfirm").textContent = "✓ Copied again!";
    } catch {
      // Select the textarea text as fallback
      document.getElementById("notifyText").select();
      document.execCommand("copy");
      document.getElementById("copyConfirm").textContent = "✓ Copied!";
    }
  });

  // Close
  document.getElementById("closeNotifyBtn").addEventListener("click", () => modal.remove());
  modal.querySelector(".modal-backdrop").addEventListener("click", () => modal.remove());
}

function escHtml(str) {
  return String(str)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;")
    .replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
