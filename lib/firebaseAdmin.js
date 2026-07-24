import 'dotenv/config';
import admin from 'firebase-admin';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const isDev = process.env.NODE_ENV !== 'production';
const useEmulators = process.env.USE_FIREBASE_EMULATORS === 'true';

if (isDev && useEmulators) {
    process.env.FIRESTORE_EMULATOR_HOST = 'localhost:8080';
    process.env.FIREBASE_AUTH_EMULATOR_HOST = 'localhost:9099';
}

// Tu ID de proyecto
const FIREBASE_PROJECT_ID = 'fitgen-d94f6'; 
const SERVICE_ACCOUNT_ENV_VAR = 'FIREBASE_SERVICE_ACCOUNT';

// Bloque de inicialización
if (admin.apps.length === 0) {
    let serviceAccount;

    if (process.env[SERVICE_ACCOUNT_ENV_VAR]) {
        try {
            serviceAccount = JSON.parse(process.env[SERVICE_ACCOUNT_ENV_VAR]);
            console.log('Firebase Admin SDK: Inicializado con variable de entorno (ROBUSTO).');
        } catch (e) {
            console.warn(
                'Firebase Admin SDK: FIREBASE_SERVICE_ACCOUNT inválido, intentando serviceAccountKey.json…',
                e.message,
            );
        }
    }

    if (!serviceAccount) {
        const localKeyPath =
            process.env.FIREBASE_SERVICE_ACCOUNT_PATH ??
            path.resolve(__dirname, '../serviceAccountKey.json');
        if (fs.existsSync(localKeyPath)) {
            serviceAccount = JSON.parse(fs.readFileSync(localKeyPath, 'utf8'));
            console.log('Firebase Admin SDK: Inicializado con serviceAccountKey.json (local).');
        }
    }

    if (!serviceAccount && !process.env[SERVICE_ACCOUNT_ENV_VAR]) {
        console.error('ERROR CRÍTICO: Variable FIREBASE_SERVICE_ACCOUNT no encontrada. Esto fallará si no está en un entorno de GCP.');
    }

    try {
        if (serviceAccount) {
            admin.initializeApp({
                credential: admin.credential.cert(serviceAccount),
                databaseURL: `https://${FIREBASE_PROJECT_ID}.firebaseio.com` 
            });
        } else {
             // Fallback: Si no hay credenciales, intentamos la inicialización simple (solo si estamos en GCP/Cloud Functions)
             admin.initializeApp();
             console.log('Firebase Admin SDK: Inicialización simple/automática (Fallback).');
        }
    } catch (e) {
        if (!e.message.includes('already been initialized')) {
            console.error('ERROR al inicializar Admin SDK:', e.message);
            throw new Error('Fallo crítico al inicializar Firebase Admin SDK. Revise credenciales.');
        }
    }
}

export const db = admin.firestore();
export const auth = admin.auth();