/* BVC Verify - Firebase Backend Integration (Auth + Firestore) */
import {
  auth,
  signUpUser,
  signInUser,
  signOutUser,
  resetUserPassword,
  resendVerificationEmail,
  checkEmailVerified,
  isBvcEmail,
  AUTHORITY_EMAILS,
  getAuthorityRecipients,
  subscribeAuth,
  submitVerification,
  fetchRequestStatus,
  fetchUserRequests,
  fetchAllRequestsForAuthority,
  subscribeAuthorityRequests,
  reviewRequest
} from './firebase.js';

import {
  GRAM_GATEWAY_CONFIG,
  createGramPaymentOrder,
  verifyGramPaymentOrder,
  openGramCheckoutPopup
} from './gateway.js';

const TYPES = [
  { id: 'degree', t: 'Degree & course completion', d: 'Confirms the degree was awarded' },
  { id: 'marks', t: 'Marks & CGPA', d: 'Semester-wise grades and final CGPA' },
  { id: 'backlogs', t: 'Backlog history', d: 'Pending or cleared backlogs' },
  { id: 'conduct', t: 'Attendance & conduct', d: 'Overall attendance and conduct record' }
];

/* ===== PAYMENT SETTINGS (Gram UPI Gateway · gateway.anujbots.in) ===== */
const PAY = {
  on: true,
  amount: 500, // Fixed 500 INR per single verification request
  payee: 'BVC Engineering College (Autonomous) - Odalarevu'
};
const feeOf = () => 500;
const amtOf = () => 500;
const payLabel = () => 'Pay ₹500 via UPI & Submit';

let currentGramOrder = null;
let gramPollTimer = null;
let gramSecondsLeft = 300;
let gramCountdownTimer = null;

function payBlock(amt) {
  if (!PAY.on) return '';

  if (currentGramOrder) {
    const min = Math.floor(Math.max(0, gramSecondsLeft) / 60);
    const sec = ('0' + (Math.max(0, gramSecondsLeft) % 60)).slice(-2);
    return `
      <div class="card" style="border:1.5px solid var(--pri);background:#FFFCF5;padding:18px;margin-top:16px">
        <div class="row" style="align-items:center;margin-bottom:12px">
          <div>
            <div class="pay-gateway-badge">🛡️ Gram UPI Gateway · Auto-Verification</div>
            <h2 style="margin:8px 0 2px;font-size:17px">Order: <code>${esc(currentGramOrder.order_id)}</code></h2>
            <div class="meta">Verification fee for <b>${esc(draft.name)} (${esc(draft.roll)})</b></div>
          </div>
          <div style="text-align:right">
            <span style="font-size:24px;font-weight:700;color:var(--pri-d)">₹500.00</span>
            <div class="meta">Expires in: <b id="gram-timer" style="color:var(--acc)">${min}:${sec}</b></div>
          </div>
        </div>

        <button type="button" class="btn" style="width:100%;margin-bottom:12px;font-size:15px;height:46px" data-a="openGramModal">📱 Open UPI Checkout (PhonePe / GPay / Paytm / QR)</button>

        <div style="display:flex;gap:8px;flex-wrap:wrap;justify-content:center;margin-bottom:12px">
          ${currentGramOrder.intent?.phonepe ? `<a href="${currentGramOrder.intent.phonepe}" target="_blank" rel="noopener" class="btn sm o">📱 Pay on PhonePe</a>` : ''}
          ${currentGramOrder.intent?.paytm ? `<a href="${currentGramOrder.intent.paytm}" target="_blank" rel="noopener" class="btn sm o">📱 Pay on Paytm</a>` : ''}
          <a href="${currentGramOrder.payment_url}" target="_blank" rel="noopener" class="btn sm o">🌐 Open Web Gateway ↗</a>
        </div>

        <div class="qrbox" style="margin:14px auto">
          <img src="${currentGramOrder.qr_url}" alt="UPI QR Code" style="width:210px;height:210px">
        </div>
        <p class="meta" style="text-align:center;font-weight:500;margin-top:6px">Scan with any UPI app (Google Pay, PhonePe, Paytm, BHIM, Cred, FamPay)</p>
        <p class="meta" style="text-align:center">UPI ID: <b>${esc(currentGramOrder.upi_id)}</b></p>

        <div class="banner" style="background:#FFF9E6;border-color:#F0B429;color:#744210;display:flex;align-items:center;gap:10px;margin-top:14px;font-size:13px">
          <span class="pulse-dot"></span>
          <span><b>Awaiting payment confirmation...</b> Once you pay in your UPI app, this page verifies and submits automatically. No manual UTR entry needed!</span>
        </div>

        <div class="row" style="justify-content:center;gap:12px;margin-top:14px">
          <button type="button" class="btn sm o" data-a="checkGramPayment">${busy ? 'Verifying...' : '🔄 Check Status Now'}</button>
          <button type="button" class="btn-link" style="font-size:12.5px" data-a="cancelGramPayment">Cancel / Restart</button>
        </div>
      </div>
    `;
  }

  return `
    <div class="card" style="border:1px solid var(--bd);background:var(--inp);padding:18px;margin-top:16px">
      <div class="row" style="align-items:center">
        <div>
          <div class="pay-gateway-badge">🛡️ Gram UPI Gateway (gateway.anujbots.in)</div>
          <h3 style="margin:6px 0 2px;font-size:16px">Statutory Verification Processing Fee</h3>
          <p class="meta">Fee required per candidate for official college records &amp; register verification.</p>
        </div>
        <div style="font-size:24px;font-weight:700;color:var(--pri-d)">₹500 INR</div>
      </div>
      <div style="margin-top:14px">
        <button type="button" class="btn" style="width:100%;height:46px;font-size:15px" data-a="startGramPay" ${busy ? 'disabled' : ''}>
          ${busy ? 'Connecting to Gateway...' : '💳 Pay ₹500 via UPI &amp; Submit Request →'}
        </button>
      </div>
      <p class="meta" style="text-align:center;margin-top:8px;font-size:12px">Supports PhonePe, Google Pay, Paytm, BHIM, Cred, Net Banking, and all UPI apps.</p>
    </div>
  `;
}

const esc = s => String(s || '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const inr = n => '₹' + n.toLocaleString('en-IN');
const names = ids => (ids || []).map(i => {
  const match = TYPES.find(t => t.id === i);
  return match ? match.t : i;
});
const date = ts => {
  if (!ts) return 'N/A';
  return new Date(typeof ts === 'string' ? ts.replace(' ', 'T') : ts).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
};
const badge = s => `<span class="badge b-${s}">${s ? (s[0].toUpperCase() + s.slice(1)) : 'Unknown'}</span>`;

// State
let currentUser = null;
let userProfile = null;
let role = 'home';
let view = 'form';
let draft = {};
let step = 1;
let sent = null;
let found = null;
let busy = false;
let trackIn = { id: '', code: '' };
let myRequests = [];
let pendingRequests = [];
let allAuthorityRequests = [];
let hodFilterBranch = 'ALL';
let hodFilterStatus = 'ALL';
let hodSearchQuery = '';
let authorityUnsub = null;
let authMode = 'signin'; // 'signin' | 'signup' | 'forgot' | 'verify'
let lastRegisteredEmail = '';
let fromNexora = /[?&]src=nexora/.test(location.search);

// Listen to Firebase Auth state
subscribeAuth((user, profile) => {
  currentUser = user;
  userProfile = profile;
  if (user && profile) {
    if (profile.companyName && !draft.company) draft.company = profile.companyName;
    if (profile.displayName && !draft.hrName) draft.hrName = profile.displayName;
    if (user.email && !draft.hr) draft.hr = user.email;
  }
  updateAcctHeader();
  updateTabs();
  if (role === 'my-requests') loadMyRequests();
  if (role === 'hod' || role === 'reviewer') startAuthorityListener();
  render();
});

function updateAcctHeader() {
  const acct = document.getElementById('acct');
  if (!acct) return;
  if (currentUser) {
    const isAuthority = isBvcEmail(currentUser.email) || ['hod', 'principal', 'placement', 'reviewer'].includes(userProfile?.role);
    const roleTag = isAuthority ? ' (HOD / College Authority)' : '';
    const name = (userProfile?.displayName || userProfile?.companyName || currentUser.email.split('@')[0]) + roleTag;
    acct.innerHTML = `<span class="who" title="${esc(currentUser.email)}">👤 ${esc(name)}</span><button class="btn sm o" data-a="signout">Sign Out</button>`;
  } else {
    acct.innerHTML = `<button class="btn sm o" data-go="auth">Sign In</button>`;
  }
}

function updateTabs() {
  const nav = document.getElementById('tabs');
  if (!nav) return;
  const isAuthority = currentUser && (isBvcEmail(currentUser.email) || ['hod', 'principal', 'placement', 'reviewer'].includes(userProfile?.role));

  let roleBtn = '';
  if (isAuthority) {
    roleBtn = `<button data-r="hod" class="${role === 'hod' ? 'on' : ''}"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 14l9-5-9-5-9 5 9 5z"/><path d="M12 14l6.16-3.422a12.083 12.083 0 01.665 6.479A11.952 11.952 0 0012 20.055a11.952 11.952 0 00-5.825-2.998 12.078 12.078 0 01.665-6.479L12 14z"/></svg><span>HOD Portal</span></button>`;
  } else if (currentUser) {
    roleBtn = `<button data-r="my-requests" class="${role === 'my-requests' ? 'on' : ''}"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/></svg><span>My Submissions</span></button>`;
  } else {
    // Show HOD Portal button for unauthenticated users so faculty can easily navigate to it
    roleBtn = `<button data-r="hod" class="${role === 'hod' ? 'on' : ''}"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 14l9-5-9-5-9 5 9 5z"/><path d="M12 14l6.16-3.422a12.083 12.083 0 01.665 6.479A11.952 11.952 0 0012 20.055a11.952 11.952 0 00-5.825-2.998 12.078 12.078 0 01.665-6.479L12 14z"/></svg><span>HOD Portal</span></button>`;
  }

  nav.innerHTML = `
    <button data-r="home" class="${role === 'home' ? 'on' : ''}"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3 11l9-8 9 8v9a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z"/></svg><span>Home</span></button>
    <button data-r="company" class="${role === 'company' ? 'on' : ''}"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5M9 13h6M9 17h4"/></svg><span>Submission</span></button>
    <button data-r="track" class="${role === 'track' ? 'on' : ''}"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="7"/><path d="M21 21l-4.3-4.3"/></svg><span>Track</span></button>
    ${roleBtn}
    <button data-r="about" class="${role === 'about' ? 'on' : ''}"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7.5v.01"/></svg><span>About</span></button>
    <button data-r="terms" class="${role === 'terms' ? 'on' : ''}"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z"/><path d="M8.5 12l2.5 2.5 4.5-5"/></svg><span>Terms</span></button>
  `;
}

document.getElementById('tabs').onclick = e => {
  const bt = e.target.closest('button'), r = bt && bt.dataset.r;
  if (!r) return;
  goto(r);
};

function logoData() {
  try {
    const im = document.querySelector('.bvclogo'), c = document.createElement('canvas');
    c.width = im.naturalWidth;
    c.height = im.naturalHeight;
    c.getContext('2d').drawImage(im, 0, 0);
    return c.toDataURL('image/jpeg', .92);
  } catch (e) {
    return null;
  }
}

function makeCert(r) {
  if (!window.jspdf) {
    alert('The PDF tool could not load. Check your internet connection and try again.');
    return;
  }
  const d = new window.jspdf.jsPDF({ orientation: 'landscape', unit: 'pt', format: 'a4' }), W = 842, H = 595, C = { align: 'center' };
  d.setFillColor(250, 248, 243); d.rect(0, 0, W, H, 'F');
  d.setDrawColor(255, 165, 0); d.setLineWidth(3); d.rect(24, 24, W - 48, H - 48);
  const lg = logoData(); if (lg) try { d.addImage(lg, 'JPEG', W / 2 - 28, 44, 56, 56); } catch (e) { }
  d.setFont('helvetica', 'bold'); d.setTextColor(200, 90, 50); d.setFontSize(12);
  d.text('BVC VERIFY  |  BVC ENGINEERING COLLEGE', W / 2, 130, C);
  d.setTextColor(45, 45, 45); d.setFontSize(30);
  d.text('Verification Certificate', W / 2, 175, C);
  d.setFont('helvetica', 'normal'); d.setFontSize(13); d.setTextColor(102, 102, 102);
  d.text('This is to confirm that the college has verified the following for', W / 2, 215, C);
  d.setFont('helvetica', 'bold'); d.setFontSize(24); d.setTextColor(45, 45, 45);
  d.text(r.name, W / 2, 255, C);
  d.setFont('helvetica', 'normal'); d.setFontSize(13); d.setTextColor(102, 102, 102);
  d.text(`Roll No. ${r.roll}  |  ${r.branch}  |  Class of ${r.year}`, W / 2, 282, C);
  d.setFont('helvetica', 'bold'); d.setTextColor(45, 45, 45);
  d.text('Verified: ' + names(r.types).join(', '), W / 2, 325, { align: 'center', maxWidth: 700 });
  d.setFont('helvetica', 'normal'); d.setTextColor(102, 102, 102);
  d.text(`Requested by ${r.company}  |  Request ${r.id}`, W / 2, 365, C);
  d.text(`Approved by ${r.decidedBy || 'the college'} on ${date(r.decidedAt || r.createdAt)}`, W / 2, 388, C);
  if (r.remark) {
    d.setFontSize(11);
    d.text('Remark: ' + r.remark, W / 2, 412, { align: 'center', maxWidth: 700 });
  }
  d.setFontSize(9); d.setTextColor(153, 153, 153);
  d.text('Issued through BVC Verify, secured by Firebase.', W / 2, H - 48, C);
  d.save(`Verification-${r.id}.pdf`);
}

const lk = (i, t, sm, h) => h ? `<a class="lk" href="${h}" target="_blank" rel="noopener"><i>${i}</i><span>${t}<small>${sm}</small></span></a>` : `<div class="lk off"><i>${i}</i><span>${t}<small>${sm}</small></span></div>`;
const FAQ = [
  ['What do I need to start?', 'Your company and HR details, plus the student\'s full name, roll number, branch and year of passing.'],
  ['Who approves a request?', 'Only the HOD or the Training & Placement (TNP) office can approve or reject a request through the authorized college portal.'],
  ['How do I get the result?', 'You get a request ID and a tracking code when you submit. Enter both on the Track page, or log in to view all your requests and download verified PDF certificates.']
];
const doc = (t, sub, body) => `<h1>${t}</h1><p class="sub">${sub}</p><div class="card doc">${body}</div>`;
const SV = x => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${x}</svg>`;
const SI = {
  ig: SV('<rect x="3" y="3" width="18" height="18" rx="5"/><circle cx="12" cy="12" r="4"/><path d="M17.5 6.5v.01"/>'),
  web: SV('<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18"/>'),
  li: SV('<rect x="3" y="3" width="18" height="18" rx="3"/><path d="M8 11v6M8 7.5v.01M12 17v-6M12 13.5a2.5 2.5 0 0 1 5 0V17"/>'),
  wa: SV('<path d="M3 21l1.7-5A8.5 8.5 0 1 1 8 19.3z"/><path d="M9 9c0 3 2.5 5.5 5.5 5.5l1-1.5-2-1-1 .7a4 4 0 0 1-1.7-1.7l.7-1-1-2z"/>')
};
const I = {
  award: SV('<circle cx="12" cy="9" r="6"/><path d="M8.5 14.5L7 21l5-3 5 3-1.5-6.5"/>'),
  cap: SV('<path d="M2 9l10-5 10 5-10 5z"/><path d="M6 11.5V16c0 1.5 2.7 3 6 3s6-1.5 6-3v-4.5M22 9v6"/>'),
  bank: SV('<path d="M3 10l9-6 9 6M5 10v8M9.5 10v8M14.5 10v8M19 10v8M3 21h18"/>'),
  shield: SV('<path d="M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z"/><path d="M8.5 12l2.5 2.5 4.5-5"/>'),
  arrow: SV('<path d="M5 12h14M13 6l6 6-6 6"/>')
};

function home() {
  return `<section class="hero"><div class="heroimg"></div><div class="eyebrow">Bonam Venkata Chalamayya Engineering College &ndash; Odalarevu</div><h1>Academic Verification <span>Portal</span></h1><p>BVC Engineering College (Autonomous), Odalarevu, East Godavari, Andhra Pradesh, is AICTE approved, NAAC accredited and affiliated to JNTUK. Submit and verify student academic records with Firebase real-time backend synchronization.</p><div class="trust">${[['AICTE', 'Approved', I.award], ['NAAC', 'Accredited', I.cap], ['JNTUK', 'Affiliated', I.bank]].map(x => `<div class="tr"><i>${x[2]}</i><div><b>${x[0]}</b><span>${x[1]}</span></div></div>`).join('')}</div></section>
  <section class="card sbm"><i class="sico">${I.shield}</i><div class="sbt"><h2>Submit a verification</h2><p class="sub" style="margin:0 0 14px">Submit a student's details and track the college's decision. Sign in to save your submissions automatically.</p><button class="btn pill" data-go="company">Get Started ${I.arrow}</button></div></section>
  <h2 class="sec">Common questions</h2><div class="svc">${FAQ.map(f => `<div class="card"><h3>${f[0]}</h3><p>${f[1]}</p></div>`).join('')}</div>
  <h2 class="sec">Official BVC links</h2><div class="links">${lk(SI.ig, 'Instagram', 'BVC Engineering College, Odalarevu', 'https://share.google/S3uXgTDYh53UeSGsc')}${lk(SI.web, 'College website', 'bvcec.edu.in', 'https://bvcec.edu.in')}${lk(SI.li, 'LinkedIn', 'bvcec-odalarevu', 'https://www.linkedin.com/school/bvcec-odalarevu/')}${lk(SI.wa, 'WhatsApp channel', 'Latest college updates', 'https://whatsapp.com/channel/0029VbBbf9o5q08lOEu9jl0d')}</div>`;
}

function about() {
  return `<h1>About BVC</h1><p class="sub">BVC Engineering College (Autonomous)</p><div class="card doc"><p>BVC Engineering College (Autonomous) is at Odalarevu in East Godavari District, Andhra Pradesh. It is AICTE approved, NAAC accredited and affiliated to JNTUK, offering B.Tech, M.Tech and diploma programmes along with Ph.D. research admissions.</p><h2>Address</h2><p>B.V.C Engineering College, Odalarevu &ndash; 533210, Allavaram Mandal, East Godavari District, Andhra Pradesh, India.</p></div>
  <h2 class="sec">How verification works</h2><div class="steps3"><div class="card"><i>1</i><h3>Enter student details</h3><p>Provide company HR contacts and student roll number.</p></div><div class="card"><i>2</i><h3>Select scope</h3><p>Choose degree, marks, backlogs, or conduct checks.</p></div><div class="card"><i>3</i><h3>Track & Download</h3><p>College officers review in Firestore; download your formal verification certificate.</p></div></div>
  <h2 class="sec">What can be verified</h2><div class="svc">${TYPES.map(t => `<div class="card"><h3>${t.t}</h3><p>${t.d}</p></div>`).join('')}</div>`;
}

function contact() {
  return `<h1>Contact</h1><p class="sub">BVC Engineering College (Autonomous)</p><div class="grid"><div class="card doc"><h2 style="margin-top:0">General</h2><p>B.V.C Engineering College, Odalarevu &ndash; 533210, Allavaram Mandal, East Godavari District, Andhra Pradesh, India.</p><p>Email: bvce@bvcgroup.in<br>Phone: +91 93925 22444<br>Mon &ndash; Sat, 9:00 AM &ndash; 4:30 PM</p></div><div class="card doc"><h2 style="margin-top:0">Training &amp; Placement Officer</h2><p>Dr. K. Rajashekar<br>Email: tpo.bvce@bvcgroup.in<br>Phone: +91 80746 15994</p></div></div>`;
}

function terms() {
  return doc('Terms &amp; Conditions', 'Please read before using BVC Verify', `<h2>1. Purpose</h2><p>This service lets employers confirm the academic records of BVC Engineering College graduates. Requests are for authorised company representatives only.</p><h2>2. Consent</h2><p>By submitting a request you confirm that you have the student's consent to verify their records with the college.</p><h2>3. Decisions</h2><p>Only the HOD or Training &amp; Placement office can approve or reject a request. Decisions reflect college archives.</p><h2>4. Acceptable use</h2><p>Use the service only for genuine hiring or background employment checks.</p>`);
}

function privacy() {
  return doc('Privacy Policy', 'How we handle information on BVC Verify', `<h2>What we collect</h2><ul><li>Company details you submit: company name, HR name, work email and phone.</li><li>Student details: name, roll number, branch and year of passing.</li><li>Firebase Authentication credentials when signed in.</li></ul><h2>Why we use it</h2><p>Only to process verification requests and issue verified certificates.</p><h2>Contact</h2><p>Questions: bvce@bvcgroup.in</p>`);
}

// Authentication Views (Sign In, Sign Up, Forgot Password, Email Verification)
function authView() {
  if (currentUser) {
    const isVerified = currentUser.emailVerified;
    return `<div class="card" style="max-width:480px;margin:20px auto">
      <h2>Signed In</h2>
      <p class="sub">You are currently signed in as <b>${esc(currentUser.email)}</b></p>
      ${!isVerified ? `
        <div class="verify-banner" style="margin:16px 0">
          <div><b>Email not verified:</b> A verification link was sent to your email.</div>
          <div style="display:flex;gap:6px;align-items:center;margin-top:6px">
            <button class="btn-chip" data-a="doResendVerify" ${busy ? 'disabled' : ''}>Resend Link</button>
            <button class="btn-chip pri" data-a="doCheckVerify" ${busy ? 'disabled' : ''}>Check Status</button>
          </div>
        </div>
      ` : `<div class="badge b-approved" style="margin-bottom:12px">✓ Email Verified</div>`}
      ${userProfile?.companyName ? `<p class="meta">Company: <b>${esc(userProfile.companyName)}</b></p>` : ''}
      ${userProfile?.role ? `<p class="meta">Role: <b>${esc(userProfile.role)}</b></p>` : ''}
      <div class="row" style="margin-top:20px">
        <button class="btn o sm" data-a="signout">Sign Out</button>
        <button class="btn sm" data-go="${userProfile?.role === 'reviewer' ? 'reviewer' : 'company'}">Continue to Portal</button>
      </div>
    </div>`;
  }

  const isSignUp = authMode === 'signup';
  const isForgot = authMode === 'forgot';
  const isVerify = authMode === 'verify';

  if (isVerify) {
    return `<div class="card verify-card">
      <div class="verify-icon">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/><polyline points="22,6 12,13 2,6"/></svg>
      </div>
      <h2>Verify your Email</h2>
      <p class="sub">We have sent a verification link to <b>${esc(lastRegisteredEmail || currentUser?.email || 'your email')}</b>.</p>
      <div class="banner" style="text-align:left;font-size:13px;margin:16px 0">
        Please check your inbox (and spam folder) and click the link to confirm your email address.
      </div>
      <div class="err" id="e-auth" style="margin-bottom:10px"></div>
      <div style="display:flex;flex-direction:column;gap:10px;margin-top:14px">
        <button class="btn" data-a="doCheckVerify" ${busy ? 'disabled' : ''}>${busy ? 'Checking...' : "I've Clicked The Verification Link ✓"}</button>
        <button class="btn o" data-a="doResendVerify" ${busy ? 'disabled' : ''}>${busy ? 'Sending...' : 'Resend Verification Email'}</button>
        <button class="btn-link" style="margin-top:6px" data-go="company">Continue to Verification Portal →</button>
      </div>
    </div>`;
  }

  return `<div class="card" style="max-width:460px;margin:20px auto">
    <div class="seg">
      <button class="${!isSignUp && !isForgot ? 'on' : ''}" data-a="authMode" data-val="signin">Sign In</button>
      <button class="${isSignUp ? 'on' : ''}" data-a="authMode" data-val="signup">Create Account</button>
    </div>
    
    ${isForgot ? `
      <h2>Reset Password</h2>
      <p class="sub">Enter your email and we'll send you a password reset link.</p>
      <div class="fld"><label>Email address</label><input id="a-email" type="email" placeholder="name@company.com"></div>
      <div class="err" id="e-auth"></div>
      <button class="btn" style="width:100%;margin-top:10px" data-a="doForgot" ${busy ? 'disabled' : ''}>${busy ? 'Sending...' : 'Send Reset Link'}</button>
      <div style="text-align:center;margin-top:14px"><button type="button" class="btn-link" data-a="authMode" data-val="signin">← Back to Sign In</button></div>
    ` : isSignUp ? `
      <h2>Create Company Account</h2>
      <p class="sub">Save and manage all your background verification requests in one place.</p>
      <div class="fld"><label>HR / Contact Full Name</label><input id="a-name" placeholder="e.g. Priya Sharma"></div>
      <div class="fld"><label>Company Name</label><input id="a-company" placeholder="e.g. Infosys Ltd"></div>
      <div class="fld"><label>Work Email</label><input id="a-email" type="email" placeholder="hr@company.com"></div>
      <div class="fld"><label>Password (min 6 characters)</label><div class="pw"><input id="a-pw" type="password"><button type="button" class="eye" aria-label="Show password">${EYE}</button></div></div>
      <div class="err" id="e-auth"></div>
      <button class="btn" style="width:100%;margin-top:12px" data-a="doSignup" ${busy ? 'disabled' : ''}>${busy ? 'Creating Account & Sending Link...' : 'Sign Up'}</button>
      <p class="meta" style="margin-top:16px;text-align:center">Already have an account? <button type="button" class="btn-link" data-a="authMode" data-val="signin">Sign In</button></p>
    ` : `
      <h2>Sign In</h2>
      <p class="sub">Sign in with your Email and Password</p>
      <div class="fld"><label>Work Email</label><input id="a-email" type="email" placeholder="hr@company.com"></div>
      <div class="fld"><label>Password</label><div class="pw"><input id="a-pw" type="password"><button type="button" class="eye" aria-label="Show password">${EYE}</button></div></div>
      <div style="text-align:right;margin-bottom:12px"><button type="button" class="btn-link" style="font-size:12.5px" data-a="authMode" data-val="forgot">Forgot password?</button></div>
      <div class="err" id="e-auth"></div>
      <button class="btn" style="width:100%;margin-top:6px" data-a="doSignin" ${busy ? 'disabled' : ''}>${busy ? 'Signing In...' : 'Sign In'}</button>
      <p class="meta" style="margin-top:16px;text-align:center">Need an account? <button type="button" class="btn-link" data-a="authMode" data-val="signup">Create one</button></p>
    `}
  </div>`;
}

// User Dashboard: "My Requests"
function myRequestsView() {
  return `
    <div class="row">
      <div>
        <h1>My Submissions</h1>
        <p class="sub">Verification requests submitted from your account.</p>
      </div>
      <button class="btn sm" data-go="company">New Request +</button>
    </div>
    ${busy ? '<div class="card empty">Loading requests...</div>' :
      !myRequests.length ? `<div class="card empty"><p>No verification requests submitted yet.</p><button class="btn sm" style="margin-top:12px" data-go="company">Submit your first request</button></div>` :
      myRequests.map(r => reqCard(r)).join('')
    }
  `;
}

// HOD & College Authority Dashboard
function hodView() {
  if (!currentUser) {
    return `
      <div class="card" style="max-width:520px;margin:30px auto;text-align:center;padding:36px 24px">
        <div class="verify-icon">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 14l9-5-9-5-9 5 9 5z"/><path d="M12 14l6.16-3.422a12.083 12.083 0 01.665 6.479A11.952 11.952 0 0012 20.055a11.952 11.952 0 00-5.825-2.998 12.078 12.078 0 01.665-6.479L12 14z"/></svg>
        </div>
        <h2>HOD &amp; College Authority Portal</h2>
        <p class="sub">Exclusive portal for Department HODs, Principal, and Training &amp; Placement Officers.</p>
        <div class="banner" style="text-align:left;margin:18px 0;font-size:13px">
          🔒 <b>Authentication Required:</b> Please sign in with your official <b>@bvcgroup.in</b> faculty email address to view and approve verification requests.
        </div>
        <button class="btn" style="width:100%" data-go="auth">Sign In with @bvcgroup.in Account →</button>
      </div>
    `;
  }

  const isAuth = isBvcEmail(currentUser.email) || ['hod', 'principal', 'placement', 'reviewer'].includes(userProfile?.role);
  if (!isAuth) {
    return `
      <div class="card" style="max-width:520px;margin:30px auto;text-align:center;padding:36px 24px">
        <div style="width:64px;height:64px;border-radius:50%;background:var(--err-l);color:var(--err);display:flex;align-items:center;justify-content:center;margin:0 auto 16px;font-size:30px;font-weight:700">✕</div>
        <h2>Access Restricted</h2>
        <p class="sub">You are signed in as <b>${esc(currentUser.email)}</b>.</p>
        <div class="banner" style="background:var(--err-l);border-color:var(--err);color:var(--err);margin:16px 0;text-align:left;font-size:13px">
          ⚠️ This portal requires an authenticated <b>@bvcgroup.in</b> domain account (Department HOD, Principal, or Placement Cell).
        </div>
        <div class="row" style="justify-content:center;gap:10px;margin-top:16px">
          <button class="btn o sm" data-a="signout">Sign Out / Switch Account</button>
          <button class="btn sm" data-go="home">Return Home</button>
        </div>
      </div>
    `;
  }

  // Filter requests
  const total = allAuthorityRequests.length;
  const pendingCount = allAuthorityRequests.filter(r => r.status === 'pending').length;
  const approvedCount = allAuthorityRequests.filter(r => r.status === 'approved').length;
  const rejectedCount = allAuthorityRequests.filter(r => r.status === 'rejected').length;

  let list = allAuthorityRequests;
  if (hodFilterBranch !== 'ALL') {
    list = list.filter(r => r.branch === hodFilterBranch);
  }
  if (hodFilterStatus !== 'ALL') {
    list = list.filter(r => r.status === hodFilterStatus);
  }
  if (hodSearchQuery) {
    const q = hodSearchQuery.toLowerCase();
    list = list.filter(r =>
      (r.name && r.name.toLowerCase().includes(q)) ||
      (r.roll && r.roll.toLowerCase().includes(q)) ||
      (r.company && r.company.toLowerCase().includes(q)) ||
      (r.id && r.id.toLowerCase().includes(q))
    );
  }

  const branches = ['ALL', 'CSE', 'CSE (AI & ML)', 'ECE', 'EEE', 'MECH', 'CIVIL', 'IT'];
  const statuses = ['ALL', 'pending', 'approved', 'rejected'];

  return `
    <div class="row" style="align-items:center;margin-bottom:12px">
      <div>
        <h1>HOD &amp; Authority Dashboard</h1>
        <p class="sub">Departmental verification requests &bull; Signed in as <b>${esc(currentUser.email)}</b></p>
      </div>
      <div style="display:flex;gap:8px">
        <button class="btn sm o" data-a="refreshAuthority">${busy ? 'Refreshing...' : '🔄 Refresh List'}</button>
      </div>
    </div>

    <!-- Stats Cards -->
    <div class="stats">
      <div class="stat"><b style="color:var(--txt)">${total}</b><span>Total Requests</span></div>
      <div class="stat"><b style="color:var(--pri)">${pendingCount}</b><span>Pending Review</span></div>
      <div class="stat"><b style="color:var(--ok)">${approvedCount}</b><span>Approved</span></div>
      <div class="stat"><b style="color:var(--err)">${rejectedCount}</b><span>Rejected</span></div>
    </div>

    <!-- Department & Status Filters -->
    <div class="card" style="padding:14px;margin-bottom:16px">
      <div style="font-size:12.5px;font-weight:600;color:var(--txt2);margin-bottom:8px">FILTER BY DEPARTMENT / BRANCH:</div>
      <div class="filters" style="margin-bottom:12px">
        ${branches.map(b => `<button class="${hodFilterBranch === b ? 'on' : ''}" data-a="setHodBranch" data-val="${b}">${b}</button>`).join('')}
      </div>
      <div style="font-size:12.5px;font-weight:600;color:var(--txt2);margin-bottom:8px">FILTER BY STATUS:</div>
      <div class="filters" style="margin-bottom:12px">
        ${statuses.map(s => `<button class="${hodFilterStatus === s ? 'on' : ''}" data-a="setHodStatus" data-val="${s}">${s.toUpperCase()}</button>`).join('')}
      </div>
      <div>
        <input id="hodSearch" placeholder="🔍 Search student name, roll number, or company..." value="${esc(hodSearchQuery)}" style="padding:9px 12px;font-size:14px">
      </div>
    </div>

    <!-- Requests List -->
    ${busy ? '<div class="card empty">Loading candidate verification requests...</div>' :
      !list.length ? '<div class="card empty">No verification requests found matching your filters.</div>' :
      list.map(r => `
        <div class="req card">
          <div class="row">
            <div>
              <h3>${esc(r.name)} <span class="meta">&middot; Roll: <b>${esc(r.roll)}</b></span></h3>
              <div class="meta"><b>Branch:</b> ${esc(r.branch)} &middot; <b>Class of:</b> ${esc(r.year)}</div>
              <div class="meta"><b>Company:</b> ${esc(r.company)} &middot; <b>HR:</b> ${esc(r.hrName || '')} (${esc(r.hrEmail || '')})</div>
              <div class="meta"><b>Request ID:</b> <code>${esc(r.id)}</code> &middot; <b>Date:</b> ${date(r.createdAt)}</div>
            </div>
            <div>${badge(r.status)}</div>
          </div>
          <div class="chips">${names(r.types).map(n => `<span class="chip">${n}</span>`).join('')}</div>
          ${r.utr ? `<div class="meta" style="margin-top:6px">Payment UTR: <code>${esc(r.utr)}</code></div>` : ''}

          ${r.status === 'pending' ? `
            <div style="margin-top:14px;border-top:1px solid var(--div);padding-top:12px">
              <div class="grid" style="margin-bottom:10px">
                <div>
                  <label>Approver / Signer Designation</label>
                  <input id="signer-${r.id}" placeholder="e.g. Dr. K. Rao (HOD CSE)" value="${esc(userProfile?.displayName || 'HOD - ' + (r.branch || ''))}">
                </div>
                <div>
                  <label>Official Remark</label>
                  <input id="rem-${r.id}" placeholder="e.g. Verified against college register; degree conferred.">
                </div>
              </div>
              <div class="row" style="justify-content:flex-end;gap:8px">
                <button class="btn no sm" data-a="doReject" data-id="${r.id}">Reject Request</button>
                <button class="btn ok sm" data-a="doApprove" data-id="${r.id}">✓ Approve Verification</button>
              </div>
            </div>
          ` : `
            <div style="margin-top:12px;border-top:1px solid var(--div);padding-top:10px;font-size:13px;color:var(--txt2)">
              <div><b>Decided By:</b> ${esc(r.decidedBy || 'College Authority')} on ${date(r.decidedAt || r.createdAt)}</div>
              ${r.remark ? `<div><b>Remark:</b> ${esc(r.remark)}</div>` : ''}
              ${r.status === 'approved' ? `
                <div style="margin-top:10px">
                  <button class="btn sm o" data-a="cert" data-id="${r.id}">📥 Download Verified Certificate (PDF)</button>
                </div>
              ` : ''}
            </div>
          `}
        </div>
      `).join('')
    }
  `;
}

function company_form() {
  const steps = ['Details', PAY.on ? 'Verification & payment' : 'Verification', 'Done'];
  const sh = `<div class="steps">${steps.map((s, i) => `<div class="${i + 1 <= step ? 'on' : ''}">${i + 1}. ${s}</div>`).join('')}</div>`;
  const head = `<div class="row"><div><h1>Verify a student</h1><p class="sub">Add student credentials and the college will confirm.</p></div><button class="btn o sm" data-go="track">Track a request</button></div>`;
  const fld = (l, id, extra, err) => `<div><label>${l}</label><input id="${id}" ${extra || ''}><div class="err" id="e-${err || id}"></div></div>`;

  if (step === 1) {
    return head + sh + `
    ${!currentUser ? `<div class="banner">💡 <b>Tip:</b> <button type="button" class="btn-chip" data-go="auth">Sign in with email →</button> to track all your requests in real-time. Guest submissions are also supported!</div>` : ''}
    <div class="card"><div class="grid">
    ${fld('Company name', 'company', `value="${esc(draft.company || '')}"`)}
    ${fld('HR name', 'hrName', `value="${esc(draft.hrName || '')}"`)}
    ${fld('HR work email', 'hr', `type="email" placeholder="hr@yourcompany.com" value="${esc(draft.hr || '')}"`)}
    ${fld('HR phone (optional)', 'phone', `inputmode="tel" placeholder="10-digit mobile number" value="${esc(draft.phone || '')}"`)}
    ${fld('Student full name', 'name', `value="${esc(draft.name || '')}"`)}
    ${fld('Roll number', 'roll', `placeholder="e.g. 21221A0572" value="${esc(draft.roll || '')}"`)}
    <div><label>Branch</label><select id="branch">${['CSE', 'CSE (AI & ML)', 'ECE', 'EEE', 'MECH', 'CIVIL', 'IT'].map(b => `<option ${draft.branch === b ? 'selected' : ''}>${b}</option>`).join('')}</select></div>
    ${fld('Year of passing', 'year', `inputmode="numeric" maxlength="4" placeholder="e.g. 2025" value="${esc(draft.year || '')}"`)}</div>
    <div style="margin-top:18px;text-align:right"><button class="btn" data-a="next1">Continue</button></div></div>`;
  }

  if (step === 2) {
    const sel = draft.types || ['degree', 'marks'];
    if (!draft.types) draft.types = sel;
    return head + sh + `<div class="card">
      <h2>Select Verification Scope</h2>
      <p class="sub">Choose the academic credentials to verify for <b>${esc(draft.name)}</b> (Roll: ${esc(draft.roll)}):</p>
      ${TYPES.map(t => `<label class="opt"><input type="checkbox" value="${t.id}" ${sel.includes(t.id) ? 'checked' : ''}><span class="t">${t.t}<small>${t.d}</small></span><span class="p">✓ Included</span></label>`).join('')}
      <div id="payarea">${payBlock(500)}</div>
      <div class="err" id="e-pay"></div>
      <div class="row" style="margin-top:16px"><button class="btn o" data-a="back" ${busy ? 'disabled' : ''}>← Back to Details</button></div>
    </div>`;
  }

  return head + sh + `<div class="card ok-box">
    <div class="tick">&#10003;</div>
    <h2>Request Submitted &amp; Payment Confirmed!</h2>
    <p class="sub">Your payment of <b>₹500 INR</b> has been verified via Gram UPI Gateway. The verification request for <b>${esc(sent.name)}</b> is now submitted to the college.</p>
    <div class="idgrid">
      <div class="idbox"><small>Request ID</small><b>${esc(sent.id)}</b></div>
      <div class="idbox"><small>Tracking Code</small><b>${esc(sent.code)}</b></div>
    </div>
    <div class="banner" style="text-align:left">
      ✓ Notifications have been dispatched simultaneously to the <b>${esc(draft.branch || 'Department')} HOD</b>, <b>Principal</b>, and <b>Placement Cell</b>.
      You can track status anytime using your Request ID and Tracking Code.
    </div>
    <div class="row" style="justify-content:center;gap:10px;margin-top:18px">
      <button class="btn" data-a="trackNow">Track This Request →</button>
      <button class="btn o" data-a="new">Submit Another Verification</button>
    </div>
  </div>`;
}

function track() {
  const form = `<div class="card" style="max-width:460px"><div class="fld"><label>Request ID</label><input id="tId" placeholder="e.g. BVC-ABC123" autocapitalize="characters" value="${esc(trackIn.id)}"></div><div class="fld"><label>Tracking code</label><input id="tCode" placeholder="10-character code" autocapitalize="characters" autocomplete="off" value="${esc(trackIn.code)}"></div><div class="err" id="e-track"></div><button class="btn" style="width:100%;margin-top:12px" data-a="check" ${busy ? 'disabled' : ''}>${busy ? 'Checking Firestore...' : 'Check status'}</button></div>`;
  return `<h1>Track a request</h1><p class="sub">Enter the request ID and tracking code you received when you submitted.</p>` + form + (found ? `<div style="margin-top:16px">${reqCard(found)}</div>` : '');
}

function reqCard(r) {
  return `<div class="req"><div class="row"><div><h3>${esc(r.name)} <span class="meta">&middot; ${esc(r.roll)}</span></h3><div class="meta">${esc(r.branch)} &middot; Class of ${esc(r.year)}</div><div class="meta">${esc(r.company)} &middot; ${esc(r.id)} &middot; ${date(r.createdAt)}</div></div>${badge(r.status)}</div>
  <div class="chips">${names(r.types).map(n => `<span class="chip">${n}</span>`).join('')}</div>
  ${r.remark ? `<div class="meta" style="margin-top:6px"><b>College remark:</b> ${esc(r.remark)}</div>` : ''}
  ${r.decidedBy ? `<div class="meta">Decided by <b>${esc(r.decidedBy)}</b> &middot; ${date(r.decidedAt)}</div>` : ''}
  ${r.status === 'pending' ? '<div class="meta" style="margin-top:8px;color:var(--warn-t)">⏳ Waiting for the college examination authority to review this request.</div>' : ''}
  ${r.status === 'approved' ? `<div class="row" style="margin-top:12px;justify-content:flex-end"><button class="btn sm" data-a="cert" data-id="${esc(r.id)}">Download verified certificate (PDF)</button></div>` : ''}</div>`;
}

async function loadMyRequests() {
  if (!currentUser) return;
  busy = true;
  render();
  try {
    myRequests = await fetchUserRequests(currentUser.uid);
  } catch (err) {
    console.error(err);
  } finally {
    busy = false;
    render();
  }
}

function startAuthorityListener() {
  if (authorityUnsub) { authorityUnsub(); authorityUnsub = null; }
  const isAuth = currentUser && (isBvcEmail(currentUser.email) || ['hod', 'principal', 'placement', 'reviewer'].includes(userProfile?.role));
  if (!isAuth) return;
  busy = true;
  render();
  authorityUnsub = subscribeAuthorityRequests(
    list => {
      allAuthorityRequests = list;
      busy = false;
      render();
    },
    err => {
      console.warn("Authority live listener falling back to single fetch:", err);
      loadAuthorityRequests();
    }
  );
}

async function loadAuthorityRequests() {
  busy = true;
  render();
  try {
    allAuthorityRequests = await fetchAllRequestsForAuthority();
  } catch (err) {
    console.error(err);
  } finally {
    busy = false;
    render();
  }
}

async function startGramPay() {
  const sel = draft.types || [];
  if (!sel.length) {
    const el = document.getElementById('e-pay');
    if (el) el.textContent = 'Please select at least one item to verify.';
    return;
  }
  busy = true;
  render();
  try {
    const order = await createGramPaymentOrder({
      customerName: draft.hrName || draft.company,
      customerPhone: draft.phone,
      roll: draft.roll,
      note: `BVC Verification: ${draft.name} (${draft.roll})`
    });
    currentGramOrder = order;
    gramSecondsLeft = order.valid_seconds || 300;
    busy = false;
    render();

    // Start countdown timer
    if (gramCountdownTimer) clearInterval(gramCountdownTimer);
    gramCountdownTimer = setInterval(() => {
      gramSecondsLeft--;
      const el = document.getElementById('gram-timer');
      if (el) {
        const m = Math.floor(Math.max(0, gramSecondsLeft) / 60);
        const s = ('0' + (Math.max(0, gramSecondsLeft) % 60)).slice(-2);
        el.textContent = `${m}:${s}`;
      }
      if (gramSecondsLeft <= 0) {
        clearInterval(gramCountdownTimer);
        clearInterval(gramPollTimer);
      }
    }, 1000);

    // Automatically open Gram Checkout popup
    openGramCheckoutPopup(order.payment_url, {
      onSuccess: async p => {
        await handlePaymentCompleted(p);
      },
      onExpired: () => {
        alert('Payment window expired. Please create a new payment order.');
        cancelGramPay();
      }
    });

    // Start polling autoverify.php every 3 seconds
    startGramPolling(order.order_id);
  } catch (err) {
    busy = false;
    render();
    const el = document.getElementById('e-pay');
    if (el) el.textContent = err.message;
  }
}

function startGramPolling(orderId) {
  if (gramPollTimer) clearInterval(gramPollTimer);
  gramPollTimer = setInterval(async () => {
    if (!currentGramOrder || currentGramOrder.order_id !== orderId) {
      clearInterval(gramPollTimer);
      return;
    }
    try {
      const res = await verifyGramPaymentOrder(orderId);
      if (res.isPaid) {
        clearInterval(gramPollTimer);
        if (gramCountdownTimer) clearInterval(gramCountdownTimer);
        await handlePaymentCompleted({
          order_id: orderId,
          amount: res.amount || 500,
          utr: res.utr || orderId
        });
      }
    } catch (e) {
      console.warn("Polling payment check:", e);
    }
  }, 3000);
}

function cancelGramPay() {
  if (gramPollTimer) clearInterval(gramPollTimer);
  if (gramCountdownTimer) clearInterval(gramCountdownTimer);
  gramPollTimer = null;
  gramCountdownTimer = null;
  currentGramOrder = null;
  render();
}

async function handlePaymentCompleted(p) {
  if (gramPollTimer) clearInterval(gramPollTimer);
  if (gramCountdownTimer) clearInterval(gramCountdownTimer);
  gramPollTimer = null;
  gramCountdownTimer = null;
  busy = true;
  render();
  try {
    const utr = p.utr || p.order_id || currentGramOrder?.order_id || 'GRAM_PAID';
    const res = await submitVerification({
      company: draft.company,
      hrName: draft.hrName,
      hrEmail: draft.hr,
      hrPhone: draft.phone,
      name: draft.name,
      roll: draft.roll,
      branch: draft.branch,
      year: draft.year,
      types: draft.types && draft.types.length ? draft.types : ['degree'],
      utr,
      paymentOrderId: p.order_id || currentGramOrder?.order_id || '',
      amount: 500
    });
    sent = res;
    trackIn = { id: res.id, code: res.trackingCode };
    currentGramOrder = null;
    draft = {};
    busy = false;
    step = 3;
    render();
  } catch (err) {
    busy = false;
    render();
    alert('Payment was confirmed, but failed to record verification request: ' + err.message);
  }
}

async function checkStatus() {
  const er = document.getElementById('e-track');
  const id = document.getElementById('tId').value.trim().toUpperCase();
  const code = document.getElementById('tCode').value.trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
  trackIn = { id, code };
  if (!id || !code) {
    er.textContent = 'Enter both the request ID and the tracking code.';
    return;
  }
  busy = true; found = null; render();
  try {
    found = await fetchRequestStatus(id, code);
  } catch (e) {
    busy = false;
    render();
    document.getElementById('e-track').textContent = e.message;
    return;
  }
  busy = false; render();
}

async function submitReq() {
  if (busy) return;
  const sel = draft.types || [];
  if (!sel.length) return;
  let utr = '';
  if (PAY.on) {
    utr = (document.getElementById('utr').value || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
    if (!/^[A-Z0-9]{12,22}$/.test(utr)) {
      document.getElementById('e-pay').textContent = 'Enter the UTR / transaction ID from your payment app (12 to 22 letters or digits)';
      return;
    }
  }
  busy = true; render();
  try {
    const res = await submitVerification({
      company: draft.company,
      hrName: draft.hrName,
      hrEmail: draft.hr,
      hrPhone: draft.phone,
      name: draft.name,
      roll: draft.roll,
      branch: draft.branch,
      year: draft.year,
      types: sel,
      utr
    });
    sent = res;
    trackIn = { id: res.id, code: res.trackingCode };
    draft = {};
    busy = false;
    step = 3;
    render();
  } catch (e) {
    busy = false;
    render();
    document.getElementById('e-pay').textContent = e.message;
  }
}

function goto(r) {
  role = r;
  view = 'form';
  step = 1;
  if (r !== 'track') found = null;
  window.scrollTo(0, 0);
  updateTabs();
  if (r === 'my-requests') loadMyRequests();
  if (r === 'hod' || r === 'reviewer') {
    startAuthorityListener();
  } else if (authorityUnsub) {
    authorityUnsub();
    authorityUnsub = null;
  }
  render();
}

function render() {
  updateAcctHeader();
  updateTabs();
  const a = document.getElementById('app');
  if (!a) return;
  const nb = fromNexora ? '<div class="banner">You opened this from the Nexora app.</div>' : '';
  const verifyNotice = (currentUser && !currentUser.emailVerified && role !== 'auth') ? `
    <div class="verify-banner">
      <div><b>📧 Verify your email:</b> A verification link was sent to <b>${esc(currentUser.email)}</b>. Check your inbox to verify your account.</div>
      <div style="display:flex;gap:6px;align-items:center">
        <button type="button" class="btn-chip" data-a="doResendVerify" ${busy ? 'disabled' : ''}>Resend Link</button>
        <button type="button" class="btn-chip pri" data-a="doCheckVerify" ${busy ? 'disabled' : ''}>Check Status</button>
      </div>
    </div>` : '';

  a.innerHTML = nb + verifyNotice + (
    role === 'home' ? home() :
    role === 'about' ? about() :
    role === 'terms' ? terms() :
    role === 'privacy' ? privacy() :
    role === 'contact' ? contact() :
    role === 'track' ? track() :
    role === 'auth' ? authView() :
    role === 'my-requests' ? myRequestsView() :
    (role === 'hod' || role === 'reviewer') ? hodView() :
    company_form()
  );
  bind();
}

function bind() {
  const a = document.getElementById('app');
  if (!a) return;

  // Eye toggle for password
  a.querySelectorAll('.eye').forEach(btn => {
    btn.onclick = () => {
      const inp = btn.previousElementSibling;
      if (inp.type === 'password') {
        inp.type = 'text';
        btn.innerHTML = EYEOFF;
      } else {
        inp.type = 'password';
        btn.innerHTML = EYE;
      }
    };
  });

  // Search candidate filter in HOD Dashboard
  const hodSearch = document.getElementById('hodSearch');
  if (hodSearch) {
    hodSearch.oninput = e => {
      hodSearchQuery = e.target.value;
      render();
      const reInp = document.getElementById('hodSearch');
      if (reInp) {
        reInp.focus();
        reInp.selectionStart = reInp.selectionEnd = reInp.value.length;
      }
    };
  }

  a.onclick = async e => {
    const t = e.target.closest('button,[data-a]');
    if (!t) return;
    if (t.dataset.go) return goto(t.dataset.go);

    const act = t.dataset.a;
    if (!act) return;

    if (act === 'cert') {
      const reqId = t.dataset.id;
      const targetReq = found?.id === reqId ? found : myRequests.find(r => r.id === reqId) || allAuthorityRequests.find(r => r.id === reqId) || found;
      if (targetReq) makeCert(targetReq);
      return;
    }

    if (act === 'signout') {
      if (authorityUnsub) { authorityUnsub(); authorityUnsub = null; }
      await signOutUser();
      goto('home');
      return;
    }

    if (act === 'authMode') {
      authMode = t.dataset.val;
      render();
      return;
    }

    if (act === 'doSignin') {
      const email = document.getElementById('a-email').value.trim();
      const pw = document.getElementById('a-pw').value;
      const er = document.getElementById('e-auth');
      if (!email || !pw) { er.textContent = 'Please enter both email and password.'; return; }
      busy = true; render();
      try {
        await signInUser(email, pw);
        busy = false;
        goto('company');
      } catch (err) {
        busy = false;
        render();
        document.getElementById('e-auth').textContent = err.message.replace('Firebase: ', '');
      }
      return;
    }

    if (act === 'doSignup') {
      const name = document.getElementById('a-name').value.trim();
      const company = document.getElementById('a-company').value.trim();
      const email = document.getElementById('a-email').value.trim();
      const pw = document.getElementById('a-pw').value;
      const er = document.getElementById('e-auth');
      if (!name || !company || !email || !pw) { er.textContent = 'Please fill in all fields.'; return; }
      if (pw.length < 6) { er.textContent = 'Password must be at least 6 characters.'; return; }
      busy = true; render();
      try {
        await signUpUser(email, pw, name, company);
        lastRegisteredEmail = email;
        authMode = 'verify';
        busy = false;
        render();
      } catch (err) {
        busy = false;
        render();
        document.getElementById('e-auth').textContent = err.message.replace('Firebase: ', '');
      }
      return;
    }

    if (act === 'doResendVerify') {
      busy = true; render();
      try {
        await resendVerificationEmail();
        busy = false;
        alert('Verification email has been sent! Please check your inbox.');
        render();
      } catch (err) {
        busy = false;
        render();
        alert('Could not resend email: ' + err.message.replace('Firebase: ', ''));
      }
      return;
    }

    if (act === 'doCheckVerify') {
      busy = true; render();
      try {
        const verified = await checkEmailVerified();
        busy = false;
        if (verified) {
          alert('🎉 Email verified successfully!');
          goto('company');
        } else {
          alert('Email is not verified yet. Please click the link sent to your inbox and try again.');
          render();
        }
      } catch (err) {
        busy = false;
        render();
        alert('Error checking status: ' + err.message.replace('Firebase: ', ''));
      }
      return;
    }

    if (act === 'doForgot') {
      const email = document.getElementById('a-email').value.trim();
      const er = document.getElementById('e-auth');
      if (!email) { er.textContent = 'Enter your email address.'; return; }
      busy = true; render();
      try {
        await resetUserPassword(email);
        busy = false;
        alert('Password reset email sent! Check your inbox.');
        authMode = 'signin';
        render();
      } catch (err) {
        busy = false;
        render();
        document.getElementById('e-auth').textContent = err.message.replace('Firebase: ', '');
      }
      return;
    }

    if (act === 'refreshReview' || act === 'refreshAuthority') {
      return loadAuthorityRequests();
    }

    if (act === 'setHodBranch') {
      hodFilterBranch = t.dataset.val;
      render();
      return;
    }

    if (act === 'setHodStatus') {
      hodFilterStatus = t.dataset.val;
      render();
      return;
    }

    if (act === 'doApprove' || act === 'doReject') {
      const reqId = t.dataset.id;
      const isApprove = act === 'doApprove';
      const remInput = document.getElementById('rem-' + reqId);
      const remark = remInput ? remInput.value.trim() : '';
      const signerInput = document.getElementById('signer-' + reqId);
      const signer = signerInput && signerInput.value.trim() ? signerInput.value.trim() : (userProfile?.displayName || userProfile?.role?.toUpperCase() || 'HOD / College Authority');
      busy = true; render();
      try {
        await reviewRequest(reqId, isApprove ? 'approved' : 'rejected', remark, signer);
        await loadAuthorityRequests();
      } catch (err) {
        alert('Failed to update request: ' + err.message);
      } finally {
        busy = false;
        render();
      }
      return;
    }

    if (act === 'startGramPay') {
      return startGramPay();
    }

    if (act === 'openGramModal') {
      if (currentGramOrder?.payment_url) {
        openGramCheckoutPopup(currentGramOrder.payment_url, {
          onSuccess: handlePaymentCompleted,
          onExpired: () => {
            alert('Payment session expired. Please restart.');
            cancelGramPay();
          }
        });
      }
      return;
    }

    if (act === 'checkGramPayment') {
      if (!currentGramOrder) return;
      busy = true; render();
      try {
        const res = await verifyGramPaymentOrder(currentGramOrder.order_id);
        if (res.isPaid) {
          await handlePaymentCompleted({
            order_id: currentGramOrder.order_id,
            amount: res.amount || 500,
            utr: res.utr || currentGramOrder.order_id
          });
          return;
        } else {
          busy = false;
          render();
          alert('Status: ' + (res.status || 'PENDING') + '. Waiting for payment confirmation.');
        }
      } catch (err) {
        busy = false;
        render();
        alert('Could not verify status: ' + err.message);
      }
      return;
    }

    if (act === 'cancelGramPayment') {
      cancelGramPay();
      return;
    }

    if (act === 'new') { cancelGramPay(); draft = {}; sent = null; step = 1; view = 'form'; return render(); }
    if (act === 'back') { cancelGramPay(); step = 1; return render(); }
    if (act === 'check') return checkStatus();
    if (act === 'submit') return submitReq();
    if (act === 'trackNow') { role = 'track'; found = null; updateTabs(); render(); return checkStatus(); }

    if (act === 'next1') {
      const g = i => document.getElementById(i).value.trim();
      const d = {
        company: g('company'),
        hrName: g('hrName'),
        hr: g('hr').toLowerCase(),
        phone: g('phone').replace(/[\s-]/g, '').replace(/^\+91/, ''),
        name: g('name'),
        roll: g('roll').toUpperCase(),
        branch: g('branch'),
        year: g('year')
      };
      const er = {
        company: !d.company && 'Enter the company name',
        hrName: !d.hrName && 'Enter the HR name',
        hr: !/^\S+@\S+\.\S+$/.test(d.hr) ? 'Enter a valid email' : '',
        phone: d.phone && !/^[6-9]\d{9}$/.test(d.phone) && 'Enter a valid 10-digit number',
        name: !d.name && 'Enter the student name',
        roll: !/^[0-9]{2}[0-9A-Z]{8}$/.test(d.roll) && 'Roll number format: e.g. 21221A0572',
        year: !/^20\d\d$/.test(d.year) && 'Enter a year like 2025'
      };
      let bad = false;
      for (const k in er) {
        const el = document.getElementById('e-' + k);
        if (el) el.textContent = er[k] || '';
        if (er[k]) bad = true;
      }
      if (bad) return;
      Object.assign(draft, d);
      step = 2;
      render();
    }
  };

  a.onchange = e => {
    if (e.target.type === 'checkbox') {
      draft.types = [...a.querySelectorAll('.opt input:checked')].map(i => i.value);
      const payArea = document.getElementById('payarea');
      if (payArea) payArea.innerHTML = payBlock(500);
    }
  };
}

// Global click delegation for elements outside #app (e.g. Header sign-out or footer links)
document.addEventListener('click', async e => {
  const g = e.target.closest('[data-go]');
  if (g) return goto(g.dataset.go);
  const a = e.target.closest('[data-a]');
  if (a && a.dataset.a === 'signout') {
    await signOutUser();
    goto('home');
  }
});

// Initial render
updateAcctHeader();
updateTabs();
render();
