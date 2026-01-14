// lib/firebaseAdmin.js

// 💡 Importante: Configurar emuladores ANTES de importar firebase-admin
import 'dotenv/config';
const isDev = process.env.NODE_ENV !== 'production';
if (isDev) {
    process.env.FIRESTORE_EMULATOR_HOST = 'localhost:8080';
    process.env.FIREBASE_AUTH_EMULATOR_HOST = 'localhost:9099';
}

import admin from 'firebase-admin';

// Tu ID de proyecto
const FIREBASE_PROJECT_ID = 'fitgen-d94f6'; 
const SERVICE_ACCOUNT_ENV_VAR = 'FIREBASE_SERVICE_ACCOUNT';

// Bloque de inicialización
if (admin.apps.length === 0) {
    let serviceAccount;

    if (process.env[SERVICE_ACCOUNT_ENV_VAR]) {
        // Usar la variable de entorno JSON (Funciona en Vercel y localmente vía dotenv)
        try {
            // La clave de servicio se parsea desde la variable de entorno
            serviceAccount = JSON.parse(process.env[SERVICE_ACCOUNT_ENV_VAR]);
            console.log('Firebase Admin SDK: Inicializado con variable de entorno (ROBUSTO).');
        } catch (e) {
            console.error('ERROR CRÍTICO: No se pudo parsear FIREBASE_SERVICE_ACCOUNT (JSON inválido)', e.message);
            throw new Error('Credenciales JSON de cuenta de servicio inválidas. Revisa el archivo .env o la configuración de Vercel.');
        }
    } else {
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