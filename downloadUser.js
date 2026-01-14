// Script para descargar un documento de usuario desde el emulador de Firestore
// Uso: node downloadUser.js

import { db } from './lib/firebaseAdmin.js';
import fs from 'fs';
import path from 'path';

console.log('Usando configuración de Firebase Admin del proyecto');
console.log('Emulador:', process.env.FIRESTORE_EMULATOR_HOST || 'No configurado');

const userId = 'GfaHSZoykbu45aXoGA1EF5RCtjTp';
const outputFile = path.resolve(`user_${userId}.json`);

async function downloadUser() {
  try {
    const docRef = db.collection('users').doc(userId);
    const doc = await docRef.get();
    if (!doc.exists) {
      console.error('No existe el usuario con ese ID');
      process.exit(1);
    }
    fs.writeFileSync(outputFile, JSON.stringify(doc.data(), null, 2));
    console.log(`Usuario descargado en ${outputFile}`);
  } catch (err) {
    console.error('Error al descargar el usuario:', err);
    process.exit(1);
  }
}

downloadUser();
