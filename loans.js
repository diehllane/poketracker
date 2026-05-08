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
  updateDoc,
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

let currentUser = null;
let unsubscribe = null;

// ─── Auth guard ───────────────────────────────────────────────────────────────
onAuthStateChanged(auth, (user) => {
  if (!user) { window.location.href = "index.html"; return; }
  currentUser = user;

  const name = user.displayName || user.email.split("@")[0];
  document.getElementById("navUsername").textContent = name;

  listenToLoans();
});

document.getElementById("logoutBtn").addEventListener("click", async () => {
  if (unsubscribe) unsubscribe();
  await signOut(auth);
  window.location.href = "index.html";
});

// ─── Modal ────────────────────────────────────────────────────────────────────
const modal     = document.getElementById("addModal");
const addBtn    = document.getElementById("addLoanBtn");
const cancelBtn = document.getElementById("cancelModalBtn");

addBtn.addEventListener("click", () => {
  modal.classList.remove("hidden");
  document.getElementById("loanForm").reset();
  document.getElementById("loan-date").value = new Date().toISOString().split("T")[0];
});

cancelBtn.addEventListener("click", closeModal);
document.querySelector(".modal-backdrop").addEventListener("click", closeModal);

function closeModal() {
  modal.classList.add("hidden");
  document.getElementById("loanError").classList.add("hidden");
}

// ─── Submit form ──────────────────────────────────────────────────────────────
document.getElementById("loanForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const errEl = document.getElementById("loanError");
  errEl.classList.add("hidden");

  const item   = document.getElementById("loan-item").value.trim();
  const owner  = document.getElementById("loan-owner").value.trim();
  const holder = document.getElementById("loan-holder").value.trim();
  const date   = document.getElementById("loan-date").value;

  if (!item || !owner || !holder || !date) {
    errEl.textContent = "All fields are required.";
    errEl.classList.remove("hidden");
    return;
  }

  try {
    await addDoc(collection(db, "users", currentUser.uid, "loans"), {
      item,
      owner,
      holder,
      date,
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
function listenToLoans() {
  const q = query(
    collection(db, "users", currentUser.uid, "loans"),
    orderBy("date", "asc")
  );

  unsubscribe = onSnapshot(q, (snap) => {
    const loans = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    renderLoans(loans);
  }, (err) => {
    console.error("Loans listener error:", err);
  });
}

// ─── Render ───────────────────────────────────────────────────────────────────
function renderLoans(loans) {
  const loading = document.getElementById("loadingState");
  const empty   = document.getElementById("emptyState");
  const table   = document.getElementById("loanTable");
  const tbody   = document.getElementById("loanBody");

  loading.classList.add("hidden");

  if (loans.length === 0) {
    empty.classList.remove("hidden");
    table.classList.add("hidden");
    return;
  }

  empty.classList.add("hidden");
  table.classList.remove("hidden");
  tbody.innerHTML = "";

  // Sort: active loans (oldest date first), then returned loans
  const active   = loans.filter(l => !l.returned).sort((a, b) => a.date.localeCompare(b.date));
  const returned = loans.filter(l => l.returned).sort((a, b) => a.date.localeCompare(b.date));
  const sorted   = [...active, ...returned];

  sorted.forEach(loan => {
    const tr = document.createElement("tr");
    if (loan.returned) tr.classList.add("returned");

    tr.innerHTML = `
      <td>${escHtml(loan.item)}</td>
      <td>${escHtml(loan.owner)}</td>
      <td>${escHtml(loan.holder)}</td>
      <td>${loan.date}</td>
      <td class="no-strike">
        <input
          type="checkbox"
          class="return-check"
          data-id="${loan.id}"
          ${loan.returned ? "checked" : ""}
          title="${loan.returned ? "Mark as not returned" : "Mark as returned"}"
        />
      </td>
      <td class="no-strike">
        <button class="btn-danger" data-id="${loan.id}" title="Delete entry">✕</button>
      </td>
    `;
    tbody.appendChild(tr);
  });

  // Return checkbox handler
  tbody.querySelectorAll(".return-check").forEach(cb => {
    cb.addEventListener("change", async () => {
      try {
        await updateDoc(doc(db, "users", currentUser.uid, "loans", cb.dataset.id), {
          returned: cb.checked
        });
      } catch (err) {
        alert("Update failed: " + err.message);
        cb.checked = !cb.checked;
      }
    });
  });

  // Delete handler
  tbody.querySelectorAll(".btn-danger").forEach(btn => {
    btn.addEventListener("click", async () => {
      if (!confirm("Delete this loan entry?")) return;
      try {
        await deleteDoc(doc(db, "users", currentUser.uid, "loans", btn.dataset.id));
      } catch (err) { alert("Delete failed: " + err.message); }
    });
  });
}

function escHtml(str) {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
