const admin = require('firebase-admin');
const fs = require('fs');
const path = require('path');

// Inicializa Firebase Admin con la clave de servicio
const serviceAccount = require('./serviceAccountKey.json');
admin.initializeApp({
  credential: admin.credential.cert(serviceAccount)
});

const db = admin.firestore();

// Lee el archivo de ejercicios
const exercisesPath = path.join(__dirname, 'colecciones', 'unified_exercises.json');
const exercises = JSON.parse(fs.readFileSync(exercisesPath, 'utf8'));

// Sube todos los ejercicios a un solo documento en la colección unified_exercises
async function uploadExercises() {
  try {
    await db.collection('unified_exercises').doc('all').set({
      exercises: exercises
    });
    console.log('Ejercicios subidos correctamente.');
    process.exit(0);
  } catch (error) {
    console.error('Error al subir los ejercicios:', error);
    process.exit(1);
  }
}

uploadExercises();
