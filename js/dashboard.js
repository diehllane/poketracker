import { auth, db, ADMIN_UID } from "./firebase-config.js";
import {
  onAuthStateChanged,
  signOut,
  createUserWithEmailAndPassword,
  updateProfile
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import {
  doc,
  setDoc,
  getDoc
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

// ─── Auth guard ───────────────────────────────────────────────────────────────
onAuthStateChanged(auth, async (user) => {
  if (!user) {
    window.location.href = "index.html";
    return;
  }

  // Populate display name
  const name = user.displayName || user.email.split("@")[0];
  document.getElementById("navUsername").textContent  = name;
  document.getElementById("dashUsername").textContent = name;

  // Show admin panel if admin
  if (user.uid === ADMIN_UID) {
    document.getElementById("adminPanel").classList.remove("hidden");
    setupAdminPanel();
  }
});

// ─── Logout ───────────────────────────────────────────────────────────────────
document.getElementById("logoutBtn").addEventListener("click", async () => {
  await signOut(auth);
  window.location.href = "index.html";
});

// ─── Admin: Create User ───────────────────────────────────────────────────────
function setupAdminPanel() {
  const createBtn   = document.getElementById("createUserBtn");
  const formEl      = document.getElementById("createUserForm");
  const cancelBtn   = document.getElementById("cancelCreateUser");
  const submitBtn   = document.getElementById("submitCreateUser");
  const errEl       = document.getElementById("createUserError");
  const successEl   = document.getElementById("createUserSuccess");

  createBtn.addEventListener("click", () => {
    formEl.classList.toggle("hidden");
    errEl.classList.add("hidden");
    successEl.classList.add("hidden");
  });

  cancelBtn.addEventListener("click", () => {
    formEl.classList.add("hidden");
    clearForm();
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

    try {
      // Create the user in Firebase Auth
      // Note: This signs in as the new user momentarily — we re-sign in the admin after.
      // For a cleaner solution in production, use Firebase Admin SDK via Cloud Functions.
      const adminEmail    = auth.currentUser.email;
      const adminPassword = prompt("Re-enter YOUR admin password to confirm account creation:");

      if (!adminPassword) {
        submitBtn.disabled = false;
        submitBtn.textContent = "Create Account";
        return;
      }

      const { signInWithEmailAndPassword } = await import(
        "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js"
      );

      // Create new user
      const cred = await createUserWithEmailAndPassword(auth, email, password);
      await updateProfile(cred.user, { displayName: name });

      // Store user profile in Firestore
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
      clearForm();
    } catch (err) {
      errEl.textContent = err.message || "Failed to create account.";
      errEl.classList.remove("hidden");
    }

    submitBtn.disabled = false;
    submitBtn.textContent = "Create Account";
  });
}

function clearForm() {
  document.getElementById("newUserEmail").value    = "";
  document.getElementById("newUserPassword").value = "";
  document.getElementById("newUserName").value     = "";
}
