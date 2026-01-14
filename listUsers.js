// Script para listar todos los usuarios en el emulador
import { initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

// Inicializa Firebase Admin apuntando al emulador
process.env.FIRESTORE_EMULATOR_HOST = 'localhost:8080';

initializeApp({
  projectId: 'demo-fitgen',
});

const db = getFirestore();

async function listUsers() {
  try {
    console.log('Conectando al emulador en:', process.env.FIRESTORE_EMULATOR_HOST);
    const usersSnapshot = await db.collection('users').get();
    
    console.log(`\nTotal de usuarios encontrados: ${usersSnapshot.size}\n`);
    
    if (usersSnapshot.empty) {
      console.log('No hay usuarios en la colección');
    } else {
      usersSnapshot.forEach(doc => {
        console.log(`ID: ${doc.id}`);
        console.log(`Datos:`, JSON.stringify(doc.data(), null, 2));
        console.log('---');
      });
    }
  } catch (err) {
    console.error('Error al listar usuarios:', err);
    process.exit(1);
  }
}

listUsers();
