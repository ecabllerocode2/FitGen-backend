import express from 'express';
import cors from 'cors';
// Nota: Importar db y auth aquí asegura que Firebase Admin se inicialice al iniciar el servidor
import { db, auth } from './lib/firebaseAdmin.js';

// --- IMPORTACIÓN DE HANDLERS ---
import saveProfileHandler from './api/profile/save.js';
import aprobarUsuarioHandler from './api/admin/aprobar-usuario.js';
import motivationHandler from './api/profile/motivation.js';
import mesocycleGenerateHandler from './api/mesocycle/generate.js';
import sessionGenerateHandler from './api/session/generate.js'; 
import sessionCompleteHandler from './api/session/complete.js';
import sessionSwapHandler from './api/session/swap-exercise.js'; // 👈 NUEVA IMPORTACIÓN DEL HANDLER

const app = express();
const PORT = 3000;

// 💡 CONFIGURACIÓN CORS ROBUSTA
const corsOptions = {
    origin: '*', // Permite todas las fuentes (vital para Codespaces -> Vercel)
    methods: ['GET', 'POST', 'OPTIONS'], 
    allowedHeaders: ['Content-Type', 'Authorization'], 
    credentials: true,
};

// 1. Usar el middleware CORS 
app.use(cors(corsOptions));

// 2. Middleware para parsear cuerpos JSON
app.use(express.json());

// --- RUTAS DE API ---

// Guardar Perfil
app.post('/api/profile/save', saveProfileHandler);

// Aprobación Admin
app.post('/api/admin/aprobar-usuario', aprobarUsuarioHandler);

// Motivación
app.post('/api/profile/motivation', motivationHandler);

// Generación del Mesociclo
app.post('/api/mesocycle/generate', mesocycleGenerateHandler);

// Generación de la Sesión del Día
app.post('/api/session/generate', sessionGenerateHandler);

// Completar Sesión (Guardar Feedback e Historial)
app.post('/api/session/complete', sessionCompleteHandler);

// 🔄 RUTA PARA INTERCAMBIO DE EJERCICIOS (SWAP)
app.post('/api/session/swap-exercise', sessionSwapHandler); // 👈 NUEVA RUTA A AGREGAR


// Ruta de estado (Health Check)
app.get('/', (req, res) => {
    res.status(200).json({
        status: 'OK',
        message: 'FitGen Backend Express/Nodemon operativo. CORS configurado.',
        dbStatus: db ? 'Firestore conectado' : 'Firestore ERROR',
        availableEndpoints: [
            'POST /api/profile/save',
            'POST /api/admin/aprobar-usuario',
            'POST /api/profile/motivation',
            'POST /api/mesocycle/generate',
            'POST /api/session/generate',
            'POST /api/session/complete',
            'POST /api/session/swap-exercise' // 👈 LISTADO ACTUALIZADO
        ]
    });
});

// Inicio del Servidor (Solo para desarrollo local)
if (process.env.NODE_ENV !== 'production') {
    app.listen(PORT, () => {
        console.log(`\n============================================`);
        console.log(`Servidor Express iniciado en: http://localhost:${PORT}`);
        console.log(`Ejecute 'npm run dev' para el reinicio automático.`);
        console.log(`============================================\n`);
    });
}

// Exportar la app para Vercel 
export default app;