const fs = require('fs');
const path = require('path');

const DEFAULT_KEY_PATH = path.join(__dirname, '../../serviceAccountKey.json');

function resolveServiceAccount() {
  if (process.env.FIREBASE_SERVICE_ACCOUNT) {
    return JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
  }
  const keyPath =
    process.env.GOOGLE_APPLICATION_CREDENTIALS ||
    (fs.existsSync(DEFAULT_KEY_PATH) ? DEFAULT_KEY_PATH : null);
  if (keyPath && fs.existsSync(keyPath)) {
    return JSON.parse(fs.readFileSync(keyPath, 'utf8'));
  }
  return null;
}

function initFirebaseAdmin({ emulator = false } = {}) {
  if (emulator) {
    process.env.FIRESTORE_EMULATOR_HOST =
      process.env.FIRESTORE_EMULATOR_HOST || 'localhost:8080';
    process.env.FIREBASE_AUTH_EMULATOR_HOST =
      process.env.FIREBASE_AUTH_EMULATOR_HOST || 'localhost:9099';
  }

  const admin = require('firebase-admin');
  if (admin.apps.length) return admin;

  if (emulator) {
    admin.initializeApp({ projectId: process.env.TARGET_PROJECT_ID || 'fitgen-d94f6' });
  } else {
    const sa = resolveServiceAccount();
    if (sa) {
      admin.initializeApp({ credential: admin.credential.cert(sa) });
    } else {
      admin.initializeApp();
    }
  }
  return admin;
}

module.exports = { initFirebaseAdmin, resolveServiceAccount };
