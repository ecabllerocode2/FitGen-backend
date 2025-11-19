const admin = require('firebase-admin');
// 1. Usa la clave de servicio en el mismo directorio.
const serviceAccount = require('./serviceAccountKey.json'); 
// 2. Importa el archivo JSON de ejercicios curados.
const exercisesData = require('./colecciones/exercises_utility.json'); 

// Inicializar Firebase Admin SDK
admin.initializeApp({
  credential: admin.credential.cert(serviceAccount)
});

const db = admin.firestore();
const collectionName = 'exercises_utility'; // Nombre de la colección en Firestore
const BATCH_SIZE = 499; // Máximo de 500 operaciones por lote

async function uploadExercises() {
  console.log(`Iniciando carga de ${exercisesData.length} ejercicios curados en Firestore...`);

  if (!exercisesData || exercisesData.length === 0) {
    console.error("El archivo JSON está vacío o no se cargó correctamente. Deteniendo.");
    return;
  }

  let batch = db.batch();
  let count = 0;
  let batchIndex = 1;

  for (const item of exercisesData) {
    // 1. Crea una nueva referencia de documento con ID autogenerado
    const docRef = db.collection(collectionName).doc();
    
    // 2. Añade la operación de escritura al lote
    batch.set(docRef, item); 
    count++;

    // 3. Si el lote está lleno, lo consolidamos (commit)
    if (count % BATCH_SIZE === 0) {
      await batch.commit();
      console.log(`✅ Lote #${batchIndex} completado (${count} documentos subidos).`);
      
      // 4. Reiniciamos el lote y el índice
      batch = db.batch(); 
      batchIndex++;
    }
  }

  // 5. Consolidar el lote final (si quedan documentos)
  if (count % BATCH_SIZE !== 0 || count === 0) {
    await batch.commit();
  }

  console.log(`\n\n✨ Carga masiva de ${count} ejercicios curados en la colección '${collectionName}' **COMPLETADA**.`);
}

uploadExercises().catch(error => {
    console.error("\nError crítico durante la carga:", error);
    process.exit(1);
});