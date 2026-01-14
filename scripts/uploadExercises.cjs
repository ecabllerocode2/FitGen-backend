// ====================================================================
// SCRIPT PARA SUBIR EJERCICIOS A FIRESTORE
// Sube todos los ejercicios a catalogs/exercises como un solo documento
// ====================================================================

const admin = require('firebase-admin');
const fs = require('fs');
const path = require('path');

// Inicializar Firebase Admin
const serviceAccount = require('../serviceAccountKey.json');

admin.initializeApp({
    credential: admin.credential.cert(serviceAccount)
});

const db = admin.firestore();

async function uploadExercises() {
    try {
        console.log('📚 Iniciando carga de ejercicios...\n');

        // Leer archivo de ejercicios
        const exercisesPath = path.join(__dirname, '../colecciones/ejercicios-actualizados.json');
        const exercisesData = JSON.parse(fs.readFileSync(exercisesPath, 'utf8'));

        console.log(`✅ Archivo leído correctamente: ${exercisesData.length} ejercicios encontrados`);

        // Validar estructura básica
        if (!Array.isArray(exercisesData)) {
            throw new Error('El archivo debe contener un array de ejercicios');
        }

        // Validar algunos ejercicios de muestra
        const sampleExercises = exercisesData.slice(0, 3);
        console.log('\n📋 Muestra de ejercicios a subir:');
        sampleExercises.forEach((ex, idx) => {
            console.log(`  ${idx + 1}. ${ex.nombre} (${ex.id})`);
        });

        // Confirmar antes de subir
        console.log('\n⚠️  IMPORTANTE: Esto sobrescribirá el catálogo completo de ejercicios');
        console.log('   Estructura: catalogs/exercises con campo "items"');
        console.log(`   Total de ejercicios: ${exercisesData.length}`);

        // Subir a Firestore
        const catalogRef = db.collection('catalogs').doc('exercises');
        
        await catalogRef.set({
            items: exercisesData,
            metadata: {
                totalExercises: exercisesData.length,
                lastUpdated: admin.firestore.FieldValue.serverTimestamp(),
                version: '2.0',
                uploadedBy: 'uploadExercises.cjs script'
            }
        });

        console.log('\n✅ Ejercicios subidos exitosamente a Firestore!');
        console.log(`   📍 Ubicación: catalogs/exercises`);
        console.log(`   📊 Total: ${exercisesData.length} ejercicios`);

        // Verificar la subida
        const verifyDoc = await catalogRef.get();
        if (verifyDoc.exists) {
            const data = verifyDoc.data();
            console.log(`\n✓ Verificación: ${data.items?.length || 0} ejercicios en base de datos`);
            console.log(`✓ Fecha de actualización: ${data.metadata?.lastUpdated?.toDate() || 'N/A'}`);
        }

        // Mostrar estadísticas
        showStatistics(exercisesData);

        process.exit(0);
    } catch (error) {
        console.error('❌ Error al subir ejercicios:', error.message);
        console.error(error);
        process.exit(1);
    }
}

function showStatistics(exercises) {
    console.log('\n📊 ESTADÍSTICAS DEL CATÁLOGO:');
    console.log('─'.repeat(50));

    // Por categoría de bloque
    const byCategory = {};
    exercises.forEach(ex => {
        const cat = ex.categoriaBloque || 'sin_categoria';
        byCategory[cat] = (byCategory[cat] || 0) + 1;
    });
    console.log('\n🏷️  Por categoría de bloque:');
    Object.entries(byCategory).sort((a, b) => b[1] - a[1]).forEach(([cat, count]) => {
        console.log(`   ${cat.padEnd(20)} : ${count}`);
    });

    // Por equipo
    const byEquipment = {};
    exercises.forEach(ex => {
        const eq = ex.equipo || 'sin_equipo';
        byEquipment[eq] = (byEquipment[eq] || 0) + 1;
    });
    console.log('\n🏋️  Por equipo:');
    Object.entries(byEquipment).sort((a, b) => b[1] - a[1]).forEach(([eq, count]) => {
        console.log(`   ${eq.padEnd(20)} : ${count}`);
    });

    // Por parte del cuerpo
    const byBodyPart = {};
    exercises.forEach(ex => {
        const part = ex.parteCuerpo || 'sin_parte';
        byBodyPart[part] = (byBodyPart[part] || 0) + 1;
    });
    console.log('\n💪 Por parte del cuerpo:');
    Object.entries(byBodyPart).sort((a, b) => b[1] - a[1]).slice(0, 10).forEach(([part, count]) => {
        console.log(`   ${part.padEnd(20)} : ${count}`);
    });

    // Ejercicios unilaterales
    const unilateral = exercises.filter(ex => ex.isUnilateral).length;
    console.log(`\n🔄 Ejercicios unilaterales: ${unilateral} (${Math.round(unilateral / exercises.length * 100)}%)`);

    // Ejercicios dinámicos
    const dynamic = exercises.filter(ex => ex.isDynamic).length;
    console.log(`⚡ Ejercicios dinámicos: ${dynamic} (${Math.round(dynamic / exercises.length * 100)}%)`);

    // Con imágenes
    const withImages = exercises.filter(ex => ex.url_img_0 || ex.url_img_1).length;
    console.log(`🖼️  Con imágenes: ${withImages} (${Math.round(withImages / exercises.length * 100)}%)`);

    console.log('─'.repeat(50));
}

// Ejecutar script
uploadExercises();
