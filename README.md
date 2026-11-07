# BVC Verify (Powered by Firebase)

Official background verification portal for BVC Engineering College (Autonomous), Odalarevu, East Godavari, Andhra Pradesh.

## Architecture
- **Backend & Database**: Cloud Firestore (`bvccollege-odalarevu` - Standard Edition Native Mode).
- **Authentication**: Firebase Authentication (Email/Password).
- **Frontend**: Lightweight SPA (HTML5, CSS3, ES6+ Modular Web SDK v10) with zero build step.
- **PDF Generation**: jsPDF (v2.5.1) client-side verification certificates.
- **Security Rules**: Production-grade `firestore.rules` enforcing strict data schemas, PII isolation, and role-based access.

## Features
- **Email/Password Auth**: HR representatives can create accounts, sign in, submit verification requests, and track all their submissions in real-time.
- **Guest Submissions & Tracking**: Employers can submit requests and track with Request ID (`BVC-XXXXXX`) and Tracking Code without signing in.
- **Reviewer Portal**: College staff/HOD accounts can review pending requests and approve/reject them with remarks.
- **PDF Certificates**: High-resolution formal verification certificates generated on the fly upon approval.

## Firebase Configuration
- **Project ID**: `bvccollege-odalarevu`
- **Web App ID**: `1:473449939169:web:09902136a3673531d677a0`
- **SDK Setup**: `js/firebase.js`

## Local Development
Serve with any local static HTTP server (to allow ES Module loading):
```bash
python -m http.server 8080
# or
npx serve .
```
Open `http://localhost:8080` in your browser.
