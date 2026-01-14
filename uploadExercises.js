// ====================================================================
// SCRIPT PARA SUBIR EJERCICIOS AL EMULADOR DE FIRESTORE
// Sube todos los ejercicios a catalogs/exercises (usa configuración de firebaseAdmin.js)
// ====================================================================

import { db } from './lib/firebaseAdmin.js';
import fs from 'fs';
import path from 'path';
import admin from 'firebase-admin';

console.log('Usando configuración de Firebase Admin del proyecto');
console.log('Emulador:', process.env.FIRESTORE_EMULATOR_HOST || 'No configurado (producción)');

async function uploadExercises() {
    try {
        const isEmulator = !!process.env.FIRESTORE_EMULATOR_HOST;
        console.log(isEmulator ? '🎮 MODO EMULADOR' : '🌐 MODO PRODUCCIÓN');
        console.log('📚 Iniciando carga de ejercicios...\n');

        // Leer archivo de ejercicios
        const exercisesPath = path.resolve('./colecciones/ejercicios-actualizados.json');
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
        console.log(`   Destino: ${isEmulator ? 'EMULADOR LOCAL' : 'FIRESTORE PRODUCCIÓN'}`);

        // Subir a Firestore
        const catalogRef = db.collection('catalogs').doc('exercises');
        
        await catalogRef.set({
            items: exercisesData,
            metadata: {
                totalExercises: exercisesData.length,
                lastUpdated: admin.firestore.FieldValue.serverTimestamp(),
                version: '2.0',
                uploadedBy: 'uploadExercises.js script',
                environment: isEmulator ? 'emulator' : 'production'
            }
        });

        console.log('\n✅ Ejercicios subidos exitosamente a Firestore!');
        console.log(`   📍 Ubicación: catalogs/exercises`);
        console.log(`   📊 Total: ${exercisesData.length} ejercicios`);
        console.log(`   🎯 Ambiente: ${isEmulator ? 'Emulador' : 'Producción'}`);

        // Verificar la subida
        const verifyDoc = await catalogRef.get();
        if (verifyDoc.exists) {
            const data = verifyDoc.data();
            console.log(`\n✓ Verificación: ${data.items?.length || 0} ejercicios en base de datos`);
            console.log(`✓ Ambiente: ${data.metadata?.environment || 'N/A'}`);
        }

        // Mostrar estadísticas
        showStatistics(exercisesData);

        if (isEmulator) {
            console.log('\n🌐 UI del Emulador disponible en: http://localhost:4000');
        }

        process.exit(0);
    } catch (error) {
        console.error('❌ Error al subir ejercicios:', error.message);
        
        if (error.code === 'ECONNREFUSED') {
            console.error('\n⚠️  El emulador no está corriendo!');
            console.error('   Ejecuta en otra terminal: npm run emulators');
            console.error('   O: firebase emulators:start');
        }
        
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
    console.log('\n🏋️  Por equipo (top 10):');
    Object.entries(byEquipment).sort((a, b) => b[1] - a[1]).slice(0, 10).forEach(([eq, count]) => {
        console.log(`   ${eq.padEnd(25)} : ${count}`);
    });

    // Por parte del cuerpo
    const byBodyPart = {};
    exercises.forEach(ex => {
        const part = ex.parteCuerpo || 'sin_parte';
        byBodyPart[part] = (byBodyPart[part] || 0) + 1;
    });
    console.log('\n💪 Por parte del cuerpo (top 10):');
    Object.entries(byBodyPart).sort((a, b) => b[1] - a[1]).slice(0, 10).forEach(([part, count]) => {
        console.log(`   ${part.padEnd(25)} : ${count}`);
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
