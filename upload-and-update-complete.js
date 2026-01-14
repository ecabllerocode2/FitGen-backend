import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import fs from 'fs';
import path from 'path';
import readline from 'readline';

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

function question(query) {
  return new Promise(resolve => rl.question(query, resolve));
}

// Configuración
const CONFIG = {
  bucket: 'excersises',  // ← Corregido: el bucket se llama "excersises"
  publicUrl: 'https://pub-8d5fa4786e4142aab39adba9d49ee865.r2.dev',
  endpoint: 'https://ab69b0f6ea139cb490887f261236b809.r2.cloudflarestorage.com',
  imagesFolder: './exercises_webp',
  jsonPath: './colecciones/ejercicios-actualizados.json'
};

async function uploadToR2AndUpdateJSON() {
  console.log('=== SUBIR IMÁGENES A CLOUDFLARE R2 Y ACTUALIZAR JSON ===\n');
  console.log('📋 Configuración:');
  console.log(`   Bucket: ${CONFIG.bucket}`);
  console.log(`   URL Pública: ${CONFIG.publicUrl}`);
  console.log(`   Endpoint: ${CONFIG.endpoint}\n`);

  // Solicitar credenciales
  console.log('🔑 Para continuar, necesitas tus credenciales de R2 API Token.');
  console.log('   Puedes obtenerlas en: Cloudflare Dashboard → R2 → Manage R2 API Tokens\n');
  
  const accessKeyId = await question('Access Key ID: ');
  const secretAccessKey = await question('Secret Access Key: ');

  if (!accessKeyId || !secretAccessKey) {
    console.log('\n❌ Credenciales requeridas. Abortando.');
    rl.close();
    return;
  }

  console.log('\n✅ Credenciales recibidas. Iniciando proceso...\n');

  // Configurar cliente S3
  const s3Client = new S3Client({
    region: 'auto',
    endpoint: CONFIG.endpoint,
    credentials: {
      accessKeyId,
      secretAccessKey,
    },
  });

  // Leer archivos de imágenes
  const files = fs.readdirSync(CONFIG.imagesFolder);
  const webpFiles = files.filter(f => f.endsWith('.webp'));
  
  console.log(`📊 Total de imágenes a subir: ${webpFiles.length}\n`);
  console.log('⏳ Subiendo imágenes... (esto puede tomar varios minutos)\n');

  let uploaded = 0;
  let errors = 0;
  const failedFiles = [];

  // Subir imágenes
  for (const file of webpFiles) {
    try {
      const filePath = path.join(CONFIG.imagesFolder, file);
      const fileContent = fs.readFileSync(filePath);
      
      const command = new PutObjectCommand({
        Bucket: CONFIG.bucket,
        Key: file,
        Body: fileContent,
        ContentType: 'image/webp',
        CacheControl: 'public, max-age=31536000',
      });

      await s3Client.send(command);
      uploaded++;
      
      // Mostrar progreso cada 50 imágenes
      if (uploaded % 50 === 0) {
        console.log(`   ✅ Progreso: ${uploaded}/${webpFiles.length} imágenes subidas`);
      }
    } catch (error) {
      console.error(`   ❌ Error subiendo ${file}: ${error.message}`);
      errors++;
      failedFiles.push(file);
    }
  }

  console.log(`\n✅ Subida completada: ${uploaded}/${webpFiles.length} imágenes`);
  if (errors > 0) {
    console.log(`⚠️  Errores: ${errors}`);
    console.log('Archivos fallidos:', failedFiles);
  }

  // Actualizar JSON
  console.log('\n🔄 Actualizando JSON con las URLs de R2...\n');

  // Crear backup
  const backupPath = CONFIG.jsonPath.replace('.json', '.backup.json');
  fs.copyFileSync(CONFIG.jsonPath, backupPath);
  console.log(`📦 Backup creado: ${backupPath}`);

  // Leer y actualizar
  const exercises = JSON.parse(fs.readFileSync(CONFIG.jsonPath, 'utf8'));
  
  exercises.forEach(exercise => {
    const id = exercise.id;
    exercise.url_img_0 = `${CONFIG.publicUrl}/${id}_0.webp`;
    exercise.url_img_1 = `${CONFIG.publicUrl}/${id}_1.webp`;
  });

  // Guardar JSON actualizado
  fs.writeFileSync(CONFIG.jsonPath, JSON.stringify(exercises, null, 2), 'utf8');
  
  console.log(`✅ JSON actualizado: ${CONFIG.jsonPath}\n`);

  // Resumen final
  console.log('=== 🎉 PROCESO COMPLETADO ===\n');
  console.log('📊 Resumen:');
  console.log(`   ✅ Imágenes subidas: ${uploaded}`);
  console.log(`   ❌ Errores: ${errors}`);
  console.log(`   📝 Ejercicios actualizados: ${exercises.length}`);
  console.log(`   🔗 URLs generadas: ${exercises.length * 2}`);
  
  console.log('\n🧪 Prueba una URL:');
  console.log(`   ${exercises[0].url_img_0}`);
  
  console.log('\n💡 Próximos pasos:');
  console.log('   1. Abre la URL de prueba en tu navegador para verificar');
  console.log('   2. Prueba las imágenes en tu aplicación');
  console.log('   3. Si todo funciona, puedes eliminar el backup');

  rl.close();
}

uploadToR2AndUpdateJSON().catch(error => {
  console.error('\n❌ Error fatal:', error);
  rl.close();
  process.exit(1);
});
