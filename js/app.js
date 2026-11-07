/* BVC Verify - Firebase Backend Integration (Auth + Firestore) */
import {
  auth,
  signUpUser,
  signInUser,
  signOutUser,
  resetUserPassword,
  resendVerificationEmail,
  checkEmailVerified,
  subscribeAuth,
  submitVerification,
  fetchRequestStatus,
  fetchUserRequests,
  fetchPendingRequestsForReviewer,
  reviewRequest
} from './firebase.js';

const TYPES = [
  { id: 'degree', t: 'Degree & course completion', d: 'Confirms the degree was awarded' },
  { id: 'marks', t: 'Marks & CGPA', d: 'Semester-wise grades and final CGPA' },
  { id: 'backlogs', t: 'Backlog history', d: 'Pending or cleared backlogs' },
  { id: 'conduct', t: 'Attendance & conduct', d: 'Overall attendance and conduct record' }
];

/* ===== PAYMENT SETTINGS ===== */
const PAY = { on: false, fees: { degree: 0, marks: 0, backlogs: 0, conduct: 0 }, qr: '', upi: '', payee: 'Bonam Venkata Chalamayya Engineering College - Odalarevu' };
const feeOf = id => PAY.fees[id] || 0;
const amtOf = sel => (sel || []).reduce((n, id) => n + feeOf(id), 0);
const payLabel = a => PAY.on ? 'Submit after payment' : 'Submit request';

const EYE = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/></svg>';
const EYEOFF = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17.9 17.9A10.1 10.1 0 0112 19c-6.4 0-10-7-10-7a18.5 18.5 0 015.1-5.9M9.9 5.2A9.7 9.7 0 0112 5c6.4 0 10 7 10 7a18.6 18.6 0 01-2.2 3.2M1 1l22 22M9.9 9.9a3 3 0 004.2 4.2"/></svg>';

function payBlock(amt) {
  if (!PAY.on) return '';
  return `${amt > 0 ? `<div class="total"><span>Total fee</span><span>${inr(amt)}</span></div>` : ''}<h2>Payment</h2><p class="meta" style="margin-bottom:10px">Scan the QR with PhonePe, Google Pay, Paytm or any UPI app and pay to ${esc(PAY.payee)}. Then enter the UTR number from the payment receipt below.</p><div class="qrbox">${PAY.qr ? `<img src="${PAY.qr}" alt="Payment QR code">` : '<div class="qrph">Payment QR will appear here</div>'}</div>${PAY.upi ? `<p class="meta" style="text-align:center;margin:8px 0">UPI ID: <b>${esc(PAY.upi)}</b></p>` : ''}<label>UTR / transaction ID</label><input id="utr" autocapitalize="characters" maxlength="22" placeholder="12-digit UTR from your payment app" value="${esc(draft.utr || '')}">`;
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
  if (role === 'reviewer') loadReviewerRequests();
  render();
});

function updateAcctHeader() {
  const acct = document.getElementById('acct');
  if (!acct) return;
  if (currentUser) {
    const name = userProfile?.displayName || userProfile?.companyName || currentUser.email.split('@')[0];
    acct.innerHTML = `<span class="who" title="${esc(currentUser.email)}">👤 ${esc(name)}</span><button class="btn sm o" data-a="signout">Sign Out</button>`;
  } else {
    acct.innerHTML = `<button class="btn sm o" data-go="auth">Sign In</button>`;
  }
}

function updateTabs() {
  const nav = document.getElementById('tabs');
  if (!nav) return;
  let extraBtn = '';
  if (currentUser && userProfile?.role === 'reviewer') {
    extraBtn = `<button data-r="reviewer" class="${role === 'reviewer' ? 'on' : ''}"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/></svg><span>Review</span></button>`;
  } else if (currentUser) {
    extraBtn = `<button data-r="my-requests" class="${role === 'my-requests' ? 'on' : ''}"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/></svg><span>My Submissions</span></button>`;
  }

  nav.innerHTML = `
    <button data-r="home" class="${role === 'home' ? 'on' : ''}"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3 11l9-8 9 8v9a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z"/></svg><span>Home</span></button>
    <button data-r="company" class="${role === 'company' ? 'on' : ''}"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5M9 13h6M9 17h4"/></svg><span>Submission</span></button>
    <button data-r="track" class="${role === 'track' ? 'on' : ''}"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="7"/><path d="M21 21l-4.3-4.3"/></svg><span>Track</span></button>
    ${extraBtn}
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
  ['What do I need to start?', 'Your company and HR details, plus the employee\'s full name, roll number, branch and year of passing.'],
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
  <section class="card sbm"><i class="sico">${I.shield}</i><div class="sbt"><h2>Submit a verification</h2><p class="sub" style="margin:0 0 14px">Submit an employee's details and track the college's decision. Sign in to save your submissions automatically.</p><button class="btn pill" data-go="company">Get Started ${I.arrow}</button></div></section>
  <h2 class="sec">Common questions</h2><div class="svc">${FAQ.map(f => `<div class="card"><h3>${f[0]}</h3><p>${f[1]}</p></div>`).join('')}</div>
  <h2 class="sec">Official BVC links</h2><div class="links">${lk(SI.ig, 'Instagram', 'BVC Engineering College, Odalarevu', 'https://share.google/S3uXgTDYh53UeSGsc')}${lk(SI.web, 'College website', 'bvcec.edu.in', 'https://bvcec.edu.in')}${lk(SI.li, 'LinkedIn', 'bvcec-odalarevu', 'https://www.linkedin.com/school/bvcec-odalarevu/')}${lk(SI.wa, 'WhatsApp channel', 'Latest college updates', 'https://whatsapp.com/channel/0029VbBbf9o5q08lOEu9jl0d')}</div>`;
}

function about() {
  return `<h1>About BVC</h1><p class="sub">BVC Engineering College (Autonomous)</p><div class="card doc"><p>BVC Engineering College (Autonomous) is at Odalarevu in East Godavari District, Andhra Pradesh. It is AICTE approved, NAAC accredited and affiliated to JNTUK, offering B.Tech, M.Tech and diploma programmes along with Ph.D. research admissions.</p><h2>Address</h2><p>B.V.C Engineering College, Odalarevu &ndash; 533210, Allavaram Mandal, East Godavari District, Andhra Pradesh, India.</p></div>
  <h2 class="sec">How verification works</h2><div class="steps3"><div class="card"><i>1</i><h3>Enter employee details</h3><p>Provide company HR contacts and employee student roll number.</p></div><div class="card"><i>2</i><h3>Select scope</h3><p>Choose degree, marks, backlogs, or conduct checks.</p></div><div class="card"><i>3</i><h3>Track & Download</h3><p>College officers review in Firestore; download your formal verification certificate.</p></div></div>
  <h2 class="sec">What can be verified</h2><div class="svc">${TYPES.map(t => `<div class="card"><h3>${t.t}</h3><p>${t.d}</p></div>`).join('')}</div>`;
}

function contact() {
  return `<h1>Contact</h1><p class="sub">BVC Engineering College (Autonomous)</p><div class="grid"><div class="card doc"><h2 style="margin-top:0">General</h2><p>B.V.C Engineering College, Odalarevu &ndash; 533210, Allavaram Mandal, East Godavari District, Andhra Pradesh, India.</p><p>Email: bvce@bvcgroup.in<br>Phone: +91 93925 22444<br>Mon &ndash; Sat, 9:00 AM &ndash; 4:30 PM</p></div><div class="card doc"><h2 style="margin-top:0">Training &amp; Placement Officer</h2><p>Dr. K. Rajashekar<br>Email: tpo.bvce@bvcgroup.in<br>Phone: +91 80746 15994</p></div></div>`;
}

function terms() {
  return doc('Terms &amp; Conditions', 'Please read before using BVC Verify', `<h2>1. Purpose</h2><p>This service lets employers confirm the academic records of BVC Engineering College graduates. Requests are for authorised company representatives only.</p><h2>2. Consent</h2><p>By submitting a request you confirm that you have the employee's consent to verify their records with the college.</p><h2>3. Decisions</h2><p>Only the HOD or Training &amp; Placement office can approve or reject a request. Decisions reflect college archives.</p><h2>4. Acceptable use</h2><p>Use the service only for genuine hiring or background employment checks.</p>`);
}

function privacy() {
  return doc('Privacy Policy', 'How we handle information on BVC Verify', `<h2>What we collect</h2><ul><li>Company details you submit: company name, HR name, work email and phone.</li><li>Employee details: name, roll number, branch and year of passing.</li><li>Firebase Authentication credentials when signed in.</li></ul><h2>Why we use it</h2><p>Only to process verification requests and issue verified certificates.</p><h2>Contact</h2><p>Questions: bvce@bvcgroup.in</p>`);
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

// Reviewer Dashboard (College Staff / HOD)
function reviewerView() {
  return `
    <div class="row">
      <div>
        <h1>Review Verification Requests</h1>
        <p class="sub">Pending applications submitted by companies for BVC graduates.</p>
      </div>
      <button class="btn sm o" data-a="refreshReview">Refresh List</button>
    </div>
    ${busy ? '<div class="card empty">Loading pending requests...</div>' :
      !pendingRequests.length ? '<div class="card empty">🎉 No pending verification requests! All requests are reviewed.</div>' :
      pendingRequests.map(r => `
        <div class="req card">
          <div class="row">
            <div>
              <h3>${esc(r.name)} <span class="meta">&middot; ${esc(r.roll)}</span></h3>
              <div class="meta"><b>Branch:</b> ${esc(r.branch)} &middot; <b>Class of</b> ${esc(r.year)}</div>
              <div class="meta"><b>Company:</b> ${esc(r.company)} &middot; <b>HR:</b> ${esc(r.hrName)} (${esc(r.hrEmail)})</div>
              <div class="meta"><b>Requested on:</b> ${date(r.createdAt)}</div>
            </div>
            ${badge(r.status)}
          </div>
          <div class="chips">${names(r.types).map(n => `<span class="chip">${n}</span>`).join('')}</div>
          ${r.utr ? `<div class="meta">Payment UTR: <code>${esc(r.utr)}</code></div>` : ''}
          <div style="margin-top:14px;border-top:1px solid var(--div);padding-top:12px">
            <label>Review Remark (optional)</label>
            <input id="rem-${r.id}" placeholder="e.g. Verified against college register; degree conferred." style="margin-bottom:10px">
            <div class="row" style="justify-content:flex-end;gap:8px">
              <button class="btn no sm" data-a="doReject" data-id="${r.id}">Reject</button>
              <button class="btn ok sm" data-a="doApprove" data-id="${r.id}">Approve Request</button>
            </div>
          </div>
        </div>
      `).join('')
    }
  `;
}

function company_form() {
  const steps = ['Details', PAY.on ? 'Verification & payment' : 'Verification', 'Done'];
  const sh = `<div class="steps">${steps.map((s, i) => `<div class="${i + 1 <= step ? 'on' : ''}">${i + 1}. ${s}</div>`).join('')}</div>`;
  const head = `<div class="row"><div><h1>Verify an employee</h1><p class="sub">Add student credentials and the college will confirm.</p></div><button class="btn o sm" data-go="track">Track a request</button></div>`;
  const fld = (l, id, extra, err) => `<div><label>${l}</label><input id="${id}" ${extra || ''}><div class="err" id="e-${err || id}"></div></div>`;

  if (step === 1) {
    return head + sh + `
    ${!currentUser ? `<div class="banner">💡 <b>Tip:</b> <button type="button" class="btn-chip" data-go="auth">Sign in with email →</button> to track all your requests in real-time. Guest submissions are also supported!</div>` : ''}
    <div class="card"><div class="grid">
    ${fld('Company name', 'company', `value="${esc(draft.company || '')}"`)}
    ${fld('HR name', 'hrName', `value="${esc(draft.hrName || '')}"`)}
    ${fld('HR work email', 'hr', `type="email" placeholder="hr@yourcompany.com" value="${esc(draft.hr || '')}"`)}
    ${fld('HR phone (optional)', 'phone', `inputmode="tel" placeholder="10-digit mobile number" value="${esc(draft.phone || '')}"`)}
    ${fld('Employee full name', 'name', `value="${esc(draft.name || '')}"`)}
    ${fld('Roll number', 'roll', `placeholder="e.g. 21221A0572" value="${esc(draft.roll || '')}"`)}
    <div><label>Branch</label><select id="branch">${['CSE', 'CSE (AI & ML)', 'ECE', 'EEE', 'MECH', 'CIVIL', 'IT'].map(b => `<option ${draft.branch === b ? 'selected' : ''}>${b}</option>`).join('')}</select></div>
    ${fld('Year of passing', 'year', `inputmode="numeric" maxlength="4" placeholder="e.g. 2025" value="${esc(draft.year || '')}"`)}</div>
    <div style="margin-top:18px;text-align:right"><button class="btn" data-a="next1">Continue</button></div></div>`;
  }

  if (step === 2) {
    const sel = draft.types || [];
    const amt = amtOf(sel);
    return head + sh + `<div class="card"><h2>What should the college verify?</h2>${TYPES.map(t => `<label class="opt"><input type="checkbox" value="${t.id}" ${sel.includes(t.id) ? 'checked' : ''}><span class="t">${t.t}<small>${t.d}</small></span>${feeOf(t.id) ? `<span class="p">${inr(feeOf(t.id))}</span>` : ''}</label>`).join('')}
    <div id="payarea">${payBlock(amt)}</div><div class="err" id="e-pay"></div>
    <div class="row" style="margin-top:16px"><button class="btn o" data-a="back">Back</button><button class="btn" data-a="submit" id="paybtn" ${sel.length && !busy ? '' : 'disabled'}>${busy ? 'Submitting to Firestore...' : payLabel(amt)}</button></div></div>`;
  }

  return head + sh + `<div class="card ok-box"><div class="tick">&#10003;</div><h2>Request submitted</h2><p class="sub">Your request for ${esc(sent.name)} has been recorded in the Firestore database.</p>
  <div class="idgrid"><div class="idbox"><small>Request ID</small><b>${esc(sent.id)}</b></div><div class="idbox"><small>Tracking code</small><b>${esc(sent.code)}</b></div></div>
  <div class="banner" style="text-align:left">Your request is now in <b>pending</b> review by the college Examination &amp; Placement cell. Write down these credentials or access them directly from your account.</div>
  <button class="btn" data-a="trackNow">Track this request</button> <button class="btn o" data-a="new">New request</button></div>`;
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

async function loadReviewerRequests() {
  busy = true;
  render();
  try {
    pendingRequests = await fetchPendingRequestsForReviewer();
  } catch (err) {
    console.error(err);
  } finally {
    busy = false;
    render();
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
  if (r === 'reviewer') loadReviewerRequests();
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
    role === 'reviewer' ? reviewerView() :
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

  a.onclick = async e => {
    const t = e.target.closest('button,[data-a]');
    if (!t) return;
    if (t.dataset.go) return goto(t.dataset.go);

    const act = t.dataset.a;
    if (!act) return;

    if (act === 'cert') {
      const reqId = t.dataset.id;
      const targetReq = found?.id === reqId ? found : myRequests.find(r => r.id === reqId) || found;
      if (targetReq) makeCert(targetReq);
      return;
    }

    if (act === 'signout') {
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

    if (act === 'refreshReview') {
      return loadReviewerRequests();
    }

    if (act === 'doApprove' || act === 'doReject') {
      const reqId = t.dataset.id;
      const isApprove = act === 'doApprove';
      const remInput = document.getElementById('rem-' + reqId);
      const remark = remInput ? remInput.value.trim() : '';
      busy = true; render();
      try {
        await reviewRequest(reqId, isApprove ? 'approved' : 'rejected', remark, userProfile?.displayName || 'College Reviewer');
        await loadReviewerRequests();
      } catch (err) {
        alert('Failed to update request: ' + err.message);
      } finally {
        busy = false;
        render();
      }
      return;
    }

    if (act === 'new') { draft = {}; sent = null; step = 1; view = 'form'; return render(); }
    if (act === 'back') { step = 1; return render(); }
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
        name: !d.name && 'Enter the employee name',
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
      const u = document.getElementById('utr');
      if (u) draft.utr = u.value;
      const amt = amtOf(draft.types);
      const payArea = document.getElementById('payarea');
      if (payArea) payArea.innerHTML = payBlock(amt);
      const b = document.getElementById('paybtn');
      if (b) {
        b.disabled = !draft.types.length;
        b.textContent = payLabel(amt);
      }
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
