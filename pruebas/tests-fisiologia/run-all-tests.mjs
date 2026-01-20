#!/usr/bin/env node
// ====================================================================
// SCRIPT MAESTRO: EJECUTA TODOS LOS TESTS DE FISIOLOGÍA
// ====================================================================

import { spawn } from 'child_process';
import { fileURLToPath } from 'url';
import path from 'path';
import fs from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

console.log('╔════════════════════════════════════════════════════════════════╗');
console.log('║        🏋️  SUITE DE TESTS DE FISIOLOGÍA DEL ENTRENAMIENTO      ║');
console.log('║                   FitGen Backend - v2.0                        ║');
console.log('╚════════════════════════════════════════════════════════════════╝\n');

const tests = [
    {
        nombre: 'Test 1: Seguridad Biomecánica',
        archivo: 'test-1-seguridad-biomecanica.mjs',
        descripcion: 'Valida que las cargas, RPE e incrementos sean seguros'
    },
    {
        nombre: 'Test 2: Sobrecarga Progresiva',
        archivo: 'test-2-sobrecarga-progresiva.mjs',
        descripcion: 'Verifica incrementos de carga científicos entre semanas'
    },
    {
        nombre: 'Test 3: Especificidad del Objetivo',
        archivo: 'test-3-especificidad-objetivo.mjs',
        descripcion: 'Valida reps, descansos y volumen según objetivo'
    }
];

let totalPasados = 0;
let totalFallados = 0;

async function ejecutarTest(test) {
    return new Promise((resolve, reject) => {
        console.log(`\n${'─'.repeat(70)}`);
        console.log(`▶️  ${test.nombre}`);
        console.log(`   ${test.descripcion}`);
        console.log(`${'─'.repeat(70)}\n`);
        
        const rutaTest = path.join(__dirname, test.archivo);
        const proceso = spawn('node', [rutaTest], {
            stdio: 'inherit',
            shell: true
        });
        
        proceso.on('close', (code) => {
            if (code === 0) {
                console.log(`\n✅ ${test.nombre} - COMPLETADO\n`);
                totalPasados++;
                resolve();
            } else {
                console.log(`\n❌ ${test.nombre} - FALLÓ (código: ${code})\n`);
                totalFallados++;
                resolve(); // No rechazar para continuar con otros tests
            }
        });
        
        proceso.on('error', (error) => {
            console.error(`\n❌ Error ejecutando ${test.nombre}:`, error);
            totalFallados++;
            resolve();
        });
    });
}

async function ejecutarTodos() {
    const inicio = Date.now();
    
    for (const test of tests) {
        await ejecutarTest(test);
        // Pequeña pausa entre tests
        await new Promise(resolve => setTimeout(resolve, 500));
    }
    
    const duracion = ((Date.now() - inicio) / 1000).toFixed(2);
    
    console.log('\n' + '═'.repeat(70));
    console.log('📊 RESUMEN FINAL');
    console.log('═'.repeat(70));
    console.log(`Tests ejecutados: ${tests.length}`);
    console.log(`✅ Pasados: ${totalPasados}`);
    console.log(`❌ Fallados: ${totalFallados}`);
    console.log(`⏱️  Duración total: ${duracion}s`);
    console.log('═'.repeat(70));
    
    // Listar archivos de resultados generados
    const dirResultados = path.join(__dirname, 'results');
    if (fs.existsSync(dirResultados)) {
        const archivos = fs.readdirSync(dirResultados)
            .filter(f => f.endsWith('.json'))
            .sort((a, b) => {
                const statA = fs.statSync(path.join(dirResultados, a));
                const statB = fs.statSync(path.join(dirResultados, b));
                return statB.mtimeMs - statA.mtimeMs;
            })
            .slice(0, 5); // Últimos 5 resultados
        
        if (archivos.length > 0) {
            console.log('\n📁 Resultados guardados en:');
            archivos.forEach(archivo => {
                console.log(`   - results/${archivo}`);
            });
        }
    }
    
    console.log('\n' + '═'.repeat(70) + '\n');
    
    if (totalFallados > 0) {
        console.log('⚠️  Algunos tests fallaron. Revisa los resultados para más detalles.\n');
        process.exit(1);
    } else {
        console.log('🎉 ¡Todos los tests pasaron exitosamente!\n');
        process.exit(0);
    }
}

// Ejecutar
ejecutarTodos().catch(error => {
    console.error('❌ Error fatal ejecutando tests:', error);
    process.exit(1);
});
