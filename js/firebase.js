// Firebase Initialization and Services using Firebase Web SDK v10 (Modular)
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import {
  getAuth,
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signOut,
  sendPasswordResetEmail,
  sendEmailVerification,
  onAuthStateChanged,
  updateProfile
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";
import {
  getFirestore,
  doc,
  setDoc,
  getDoc,
  collection,
  query,
  where,
  getDocs,
  updateDoc,
  serverTimestamp,
  orderBy,
  limit
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";

export const firebaseConfig = {
  apiKey: "AIzaSyDd83pFxihWdTsTNVLfviLyCW__-UZQjq0",
  authDomain: "bvccollege-odalarevu.firebaseapp.com",
  projectId: "bvccollege-odalarevu",
  storageBucket: "bvccollege-odalarevu.firebasestorage.app",
  messagingSenderId: "473449939169",
  appId: "1:473449939169:web:09902136a3673531d677a0"
};

// Initialize Firebase
export const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app);

// Authentication Helpers
export const isBvcEmail = email => /@bvcgroup\.in$/i.test(email || '');

export const AUTHORITY_EMAILS = {
  principal: 'principal@bvcgroup.in',
  placement: 'tpo.bvce@bvcgroup.in',
  hods: {
    'CSE': 'hod.cse@bvcgroup.in',
    'CSE (AI & ML)': 'hod.aiml@bvcgroup.in',
    'ECE': 'hod.ece@bvcgroup.in',
    'EEE': 'hod.eee@bvcgroup.in',
    'MECH': 'hod.mech@bvcgroup.in',
    'CIVIL': 'hod.civil@bvcgroup.in',
    'IT': 'hod.it@bvcgroup.in'
  }
};

export function getAuthorityRecipients(branch) {
  const hodEmail = AUTHORITY_EMAILS.hods[branch] || AUTHORITY_EMAILS.hods['CSE'];
  return [
    { role: 'HOD (' + branch + ')', email: hodEmail },
    { role: 'Principal', email: AUTHORITY_EMAILS.principal },
    { role: 'Placement Cell', email: AUTHORITY_EMAILS.placement }
  ];
}

export async function signUpUser(email, password, displayName, companyName, branch) {
  const credential = await createUserWithEmailAndPassword(auth, email, password);
  const user = credential.user;

  if (displayName) {
    await updateProfile(user, { displayName });
  }

  // Send email verification link to user's inbox
  try {
    await sendEmailVerification(user);
  } catch (err) {
    console.warn("Could not send email verification immediately:", err);
  }

  // Determine role based on email domain
  const isAuthority = isBvcEmail(email);
  let role = 'company';
  if (isAuthority) {
    const lower = email.toLowerCase();
    if (lower.includes('principal')) role = 'principal';
    else if (lower.includes('tpo') || lower.includes('placement')) role = 'placement';
    else role = 'hod';
  }

  // Create user profile in Firestore
  const userRef = doc(db, "users", user.uid);
  const profileData = {
    uid: user.uid,
    email: user.email,
    displayName: displayName || "",
    companyName: isAuthority ? "BVC Engineering College" : (companyName || ""),
    role,
    branch: branch || "",
    createdAt: serverTimestamp()
  };
  await setDoc(userRef, profileData);

  return { user, profile: profileData };
}

export async function resendVerificationEmail() {
  if (!auth.currentUser) throw new Error("Please sign in first to request a verification email.");
  await sendEmailVerification(auth.currentUser);
}

export async function checkEmailVerified() {
  if (!auth.currentUser) return false;
  await auth.currentUser.reload();
  return auth.currentUser.emailVerified;
}

export async function signInUser(email, password) {
  const credential = await signInWithEmailAndPassword(auth, email, password);
  const user = credential.user;
  const userRef = doc(db, "users", user.uid);
  const snap = await getDoc(userRef);
  let profile;
  const isAuthority = isBvcEmail(user.email);
  const authorityRole = user.email.toLowerCase().includes('principal') ? 'principal' : (user.email.toLowerCase().includes('tpo') ? 'placement' : 'hod');

  if (snap.exists()) {
    profile = snap.data();
    if (isAuthority && profile.role === 'company') {
      profile.role = authorityRole;
      await setDoc(userRef, { role: authorityRole }, { merge: true });
    }
  } else {
    profile = {
      uid: user.uid,
      email: user.email,
      displayName: user.displayName || "",
      companyName: isAuthority ? "BVC Engineering College" : "",
      role: isAuthority ? authorityRole : 'company',
      createdAt: serverTimestamp()
    };
    await setDoc(userRef, profile);
  }
  return { user, profile };
}

export async function signOutUser() {
  await signOut(auth);
}

export async function resetUserPassword(email) {
  await sendPasswordResetEmail(auth, email);
}

export function subscribeAuth(callback) {
  return onAuthStateChanged(auth, async (user) => {
    if (user) {
      try {
        const snap = await getDoc(doc(db, "users", user.uid));
        let profile = snap.exists() ? snap.data() : null;
        const isAuthority = isBvcEmail(user.email);
        const authorityRole = user.email.toLowerCase().includes('principal') ? 'principal' : (user.email.toLowerCase().includes('tpo') ? 'placement' : 'hod');
        if (!profile) {
          profile = {
            uid: user.uid,
            email: user.email,
            displayName: user.displayName || "",
            companyName: isAuthority ? "BVC Engineering College" : "",
            role: isAuthority ? authorityRole : "company"
          };
        } else if (isAuthority && profile.role === 'company') {
          profile.role = authorityRole;
        }
        callback(user, profile);
      } catch (err) {
        const isAuthority = isBvcEmail(user.email);
        callback(user, { uid: user.uid, email: user.email, role: isAuthority ? "hod" : "company" });
      }
    } else {
      callback(null, null);
    }
  });
}

// Generate human-friendly ID and Tracking Code
function generateRequestId() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let out = 'BVC-';
  for (let i = 0; i < 6; i++) {
    out += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return out;
}

function generateTrackingCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let out = '';
  for (let i = 0; i < 10; i++) {
    out += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return out;
}

// Firestore Verification Request Operations
export async function submitVerification(req) {
  const id = generateRequestId();
  const trackingCode = generateTrackingCode();
  const docRef = doc(db, "verification_requests", id);

  const payload = {
    id,
    trackingCode,
    company: req.company.trim(),
    hrName: req.hrName.trim(),
    hrEmail: req.hrEmail.trim(),
    hrPhone: req.hrPhone ? req.hrPhone.trim() : "",
    name: req.name.trim(),
    roll: req.roll.trim().toUpperCase(),
    branch: req.branch,
    year: String(req.year).trim(),
    types: req.types,
    status: "pending",
    utr: req.utr ? req.utr.trim().toUpperCase() : "",
    createdAt: serverTimestamp(),
    createdByUid: auth.currentUser ? auth.currentUser.uid : ""
  };

  await setDoc(docRef, payload);
  return { id, trackingCode, name: payload.name };
}

export async function fetchRequestStatus(id, trackingCode) {
  const cleanId = id.trim().toUpperCase();
  const cleanCode = trackingCode.trim().toUpperCase().replace(/[^A-Z0-9]/g, '');

  const docRef = doc(db, "verification_requests", cleanId);
  const snap = await getDoc(docRef);

  if (!snap.exists()) {
    throw new Error("No verification request found with ID: " + cleanId);
  }

  const data = snap.data();
  if (data.trackingCode !== cleanCode) {
    throw new Error("Invalid tracking code for request " + cleanId);
  }

  // Convert Firestore Timestamps to ISO strings for existing UI compatibility
  return {
    ...data,
    createdAt: data.createdAt?.toDate ? data.createdAt.toDate().toISOString() : data.createdAt,
    decidedAt: data.decidedAt?.toDate ? data.decidedAt.toDate().toISOString() : data.decidedAt
  };
}

export async function fetchUserRequests(uid) {
  if (!uid) return [];
  const q = query(
    collection(db, "verification_requests"),
    where("createdByUid", "==", uid),
    limit(50)
  );
  const snap = await getDocs(q);
  const list = [];
  snap.forEach(d => {
    const data = d.data();
    list.push({
      ...data,
      createdAt: data.createdAt?.toDate ? data.createdAt.toDate().toISOString() : data.createdAt,
      decidedAt: data.decidedAt?.toDate ? data.decidedAt.toDate().toISOString() : data.decidedAt
    });
  });
  return list;
}

export async function fetchPendingRequestsForReviewer() {
  const q = query(
    collection(db, "verification_requests"),
    where("status", "==", "pending"),
    limit(50)
  );
  const snap = await getDocs(q);
  const list = [];
  snap.forEach(d => {
    const data = d.data();
    list.push({
      ...data,
      createdAt: data.createdAt?.toDate ? data.createdAt.toDate().toISOString() : data.createdAt
    });
  });
  return list;
}

export async function fetchAllRequestsForAuthority() {
  const q = query(
    collection(db, "verification_requests"),
    limit(100)
  );
  const snap = await getDocs(q);
  const list = [];
  snap.forEach(d => {
    const data = d.data();
    list.push({
      ...data,
      createdAt: data.createdAt?.toDate ? data.createdAt.toDate().toISOString() : data.createdAt,
      decidedAt: data.decidedAt?.toDate ? data.decidedAt.toDate().toISOString() : data.decidedAt
    });
  });
  list.sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0));
  return list;
}

export async function reviewRequest(id, status, remark, decidedBy) {
  const docRef = doc(db, "verification_requests", id);
  await updateDoc(docRef, {
    status,
    remark: remark || "",
    decidedBy: decidedBy || "BVC Examination Cell",
    decidedAt: serverTimestamp()
  });
}
