const admin = require('firebase-admin');
const fs = require('fs');
const path = require('path');

// 1. CONFIGURACIÓN: Asegúrate de que serviceAccountKey.json está aquí.
const serviceAccount = require('./serviceAccountKey.json'); 

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount)
});

const db = admin.firestore();

// =================================================================
// 2. 🚨 ¡IMPORTANTE! Reemplaza con el ID de un usuario real que SÍ tenga un plan.
const TARGET_USER_ID = 'u9whVKtPEeT8VNvpRIJlX6ZebfI3'; 
// =================================================================

async function exportUserData(userId) {
  if (userId === 'REEMPLAZAR_CON_EL_UID_DEL_USUARIO') {
    console.error("❌ ERROR: Debes reemplazar el placeholder con un ID de usuario válido de Firestore.");
    return;
  }
  
  console.log(`Buscando datos del usuario: ${userId}...`);
  
  try {
    const userDocRef = db.collection('users').doc(userId);
    const docSnap = await userDocRef.get();

    if (!docSnap.exists) {
      console.error(`❌ Error: Documento de usuario con ID ${userId} no encontrado en 'users'.`);
      return;
    }

    const userData = docSnap.data();

    // === Obtener el documento específico de la subcolección history ===
    const historyDocId = '0MjZUcZ7nC39Q5Lrfdvm';
    const historyDocSnap = await userDocRef.collection('history').doc(historyDocId).get();
    let historyData = null;
    if (historyDocSnap.exists) {
      historyData = historyDocSnap.data();
    }

    // Adjuntar el documento de history al objeto exportado
    userData._history = {};
    userData._history[historyDocId] = historyData;

    const outputFileName = `user_data_${userId}.json`;
    const outputPath = path.join(__dirname, outputFileName);

    // 3. CONVERSIÓN Y ESCRITURA
    // Usamos stringify con formateo (null, 2) para que sea legible
    const jsonContent = JSON.stringify(userData, null, 2); 
    
    fs.writeFileSync(outputPath, jsonContent, 'utf8');
    
    console.log(`\n\n✅ Datos exportados exitosamente a: ${outputPath}`);
    console.log("👉 Abre el archivo y revisa especialmente las propiedades de 'currentMesocycle' y '_history'.");

  } catch (error) {
    console.error("Error al exportar los datos del usuario:", error);
  }
}

exportUserData(TARGET_USER_ID).catch(error => {
    console.error("\nError crítico en el script:", error);
    process.exit(1);
});