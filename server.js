import express from 'express';
import cors from 'cors';
// Nota: Importar db y auth aquí asegura que Firebase Admin se inicialice al iniciar el servidor
import { db, auth } from './lib/firebaseAdmin.js'; 
import saveProfileHandler from './api/profile/save.js'; 

// 💡 CAMBIO 1: Importar el nuevo handler de aprobación
import aprobarUsuarioHandler from './api/admin/aprobar-usuario.js'; 

const app = express();
const PORT = 3000;

// Configuración Global de Express
app.use(cors({ origin: '*' })); // Permite peticiones desde el frontend (PWA)
app.use(express.json());       // Middleware para parsear cuerpos JSON

// --- RUTAS DE API ---
// Ruta existente
app.post('/api/profile/save', saveProfileHandler); 

// 💡 CAMBIO 2: Definir la nueva ruta de administración
app.post('/api/admin/aprobar-usuario', aprobarUsuarioHandler); 

// Ruta de estado
app.get('/', (req, res) => {
    res.status(200).json({ 
        status: 'OK',
        message: 'FitGen Backend Express/Nodemon operativo.',
        dbStatus: db ? 'Firestore conectado' : 'Firestore ERROR',
        // 💡 CAMBIO 3: Actualizar el mensaje de bienvenida
        availableEndpoints: ['POST /api/profile/save', 'POST /api/admin/aprobar-usuario']
    });
});

// Inicio del Servidor
app.listen(PORT, () => {
    console.log(`\n============================================`);
    console.log(`Servidor Express iniciado en: http://localhost:${PORT}`);
    console.log(`Ejecute 'npm run dev' para el reinicio automático.`);
    console.log(`============================================\n`);
});