import { auth, db, ADMIN_UID } from "./firebase-config.js";
import {
  onAuthStateChanged,
  signOut,
  createUserWithEmailAndPassword,
  updateProfile,
  reauthenticateWithCredential,
  EmailAuthProvider,
  updatePassword,
  signInWithEmailAndPassword
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import {
  doc,
  getDoc,
  setDoc
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

// ─── Auth guard ───────────────────────────────────────────────────────────────
onAuthStateChanged(auth, async (user) => {
  if (!user) { window.location.href = "index.html"; return; }

  const name = user.displayName || user.email.split("@")[0];
  document.getElementById("navUsername").textContent  = name;
  document.getElementById("dashUsername").textContent = name;

  if (user.uid === ADMIN_UID) {
    document.getElementById("adminPanel").classList.remove("hidden");
    setupAdminPanel();
  }

  setupPasswordChange();
});

// ─── Logout ───────────────────────────────────────────────────────────────────
document.getElementById("logoutBtn").addEventListener("click", async () => {
  await signOut(auth);
  window.location.href = "index.html";
});

// ─── Change Password ──────────────────────────────────────────────────────────
function setupPasswordChange() {
  const toggleBtn = document.getElementById("changePasswordBtn");
  const formEl    = document.getElementById("changePasswordForm");
  const cancelBtn = document.getElementById("cancelChangePassword");
  const submitBtn = document.getElementById("submitChangePassword");
  const errEl     = document.getElementById("changePasswordError");
  const successEl = document.getElementById("changePasswordSuccess");

  toggleBtn.addEventListener("click", () => {
    formEl.classList.toggle("hidden");
    errEl.classList.add("hidden");
    successEl.classList.add("hidden");
    clearPasswordForm();
  });

  cancelBtn.addEventListener("click", () => {
    formEl.classList.add("hidden");
    clearPasswordForm();
  });

  submitBtn.addEventListener("click", async () => {
    errEl.classList.add("hidden");
    successEl.classList.add("hidden");

    const current  = document.getElementById("currentPassword").value;
    const newPw    = document.getElementById("newPassword").value;
    const confirm  = document.getElementById("confirmPassword").value;

    if (!current || !newPw || !confirm) {
      errEl.textContent = "All fields are required.";
      errEl.classList.remove("hidden");
      return;
    }
    if (newPw.length < 6) {
      errEl.textContent = "New password must be at least 6 characters.";
      errEl.classList.remove("hidden");
      return;
    }
    if (newPw !== confirm) {
      errEl.textContent = "New passwords do not match.";
      errEl.classList.remove("hidden");
      return;
    }

    submitBtn.disabled = true;
    submitBtn.textContent = "Updating…";

    try {
      const user       = auth.currentUser;
      const credential = EmailAuthProvider.credential(user.email, current);
      await reauthenticateWithCredential(user, credential);
      await updatePassword(user, newPw);

      successEl.textContent = "Password updated successfully.";
      successEl.classList.remove("hidden");
      clearPasswordForm();
      setTimeout(() => {
        formEl.classList.add("hidden");
        successEl.classList.add("hidden");
      }, 3000);
    } catch (err) {
      if (err.code === "auth/wrong-password" || err.code === "auth/invalid-credential") {
        errEl.textContent = "Current password is incorrect.";
      } else {
        errEl.textContent = err.message || "Failed to update password.";
      }
      errEl.classList.remove("hidden");
    }

    submitBtn.disabled = false;
    submitBtn.textContent = "Update Password";
  });
}

function clearPasswordForm() {
  document.getElementById("currentPassword").value = "";
  document.getElementById("newPassword").value     = "";
  document.getElementById("confirmPassword").value = "";
}

// ─── Admin: Create User ───────────────────────────────────────────────────────
function setupAdminPanel() {
  const createBtn  = document.getElementById("createUserBtn");
  const formEl     = document.getElementById("createUserForm");
  const cancelBtn  = document.getElementById("cancelCreateUser");
  const submitBtn  = document.getElementById("submitCreateUser");
  const errEl      = document.getElementById("createUserError");
  const successEl  = document.getElementById("createUserSuccess");

  createBtn.addEventListener("click", () => {
    formEl.classList.toggle("hidden");
    errEl.classList.add("hidden");
    successEl.classList.add("hidden");
  });

  cancelBtn.addEventListener("click", () => {
    formEl.classList.add("hidden");
    clearAdminForm();
  });

  submitBtn.addEventListener("click", async () => {
    errEl.classList.add("hidden");
    successEl.classList.add("hidden");

    const email    = document.getElementById("newUserEmail").value.trim();
    const password = document.getElementById("newUserPassword").value;
    const name     = document.getElementById("newUserName").value.trim();

    if (!email || !password || !name) {
      errEl.textContent = "All fields are required.";
      errEl.classList.remove("hidden");
      return;
    }
    if (password.length < 6) {
      errEl.textContent = "Password must be at least 6 characters.";
      errEl.classList.remove("hidden");
      return;
    }

    submitBtn.disabled = true;
    submitBtn.textContent = "Creating…";

    const adminEmail    = auth.currentUser.email;
    const adminPassword = prompt("Re-enter YOUR admin password to confirm account creation:");

    if (!adminPassword) {
      submitBtn.disabled = false;
      submitBtn.textContent = "Create Account";
      return;
    }

    try {
      const cred = await createUserWithEmailAndPassword(auth, email, password);
      await updateProfile(cred.user, { displayName: name });
      await setDoc(doc(db, "users", cred.user.uid), {
        displayName: name,
        email,
        createdAt: new Date().toISOString(),
        daycareRate: 15
      });

      // Sign admin back in
      await signInWithEmailAndPassword(auth, adminEmail, adminPassword);

      successEl.textContent = `Account created for ${name} (${email})`;
      successEl.classList.remove("hidden");
      clearAdminForm();
    } catch (err) {
      // Try to re-sign admin in if something failed mid-way
      try { await signInWithEmailAndPassword(auth, adminEmail, adminPassword); } catch {}
      errEl.textContent = err.message || "Failed to create account.";
      errEl.classList.remove("hidden");
    }

    submitBtn.disabled = false;
    submitBtn.textContent = "Create Account";
  });
}

function clearAdminForm() {
  document.getElementById("newUserEmail").value    = "";
  document.getElementById("newUserPassword").value = "";
  document.getElementById("newUserName").value     = "";
}
