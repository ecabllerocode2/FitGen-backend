// Script para crear un usuario de prueba en el emulador
import { initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

// Inicializa Firebase Admin apuntando al emulador
process.env.FIRESTORE_EMULATOR_HOST = 'localhost:8080';

initializeApp({
  projectId: 'demo-fitgen',
});

const db = getFirestore();

const userId = 'MztPgfyiDp4QpPmD29yAMWgpaKkY';

// Datos de ejemplo para el usuario
const userData = {
  uid: userId,
  email: 'test@example.com',
  createdAt: new Date().toISOString(),
  // Agrega más campos según tu estructura de usuario
};

async function createUser() {
  try {
    await db.collection('users').doc(userId).set(userData);
    console.log(`Usuario creado con ID: ${userId}`);
  } catch (err) {
    console.error('Error al crear usuario:', err);
    process.exit(1);
  }
}

createUser();
