// 📄 server.js (Corregido)

import express from 'express';
import cors from 'cors';
// Nota: Importar db y auth aquí asegura que Firebase Admin se inicialice al iniciar el servidor
import { db, auth } from './lib/firebaseAdmin.js';
import saveProfileHandler from './api/profile/save.js';
import aprobarUsuarioHandler from './api/admin/aprobar-usuario.js';

// 💡 CAMBIO 1: Importar el handler de la frase motivacional
import motivationHandler from './api/profile/motivation.js';

const app = express();
const PORT = 3000;

// 💡 CORRECCIÓN CORS: Definición más robusta para Vercel
const corsOptions = {
    origin: '*', // Permite todas las fuentes (vital para Codespaces -> Vercel)
    methods: ['GET', 'POST', 'OPTIONS'], // ¡Asegurar que OPTIONS esté explícito!
    allowedHeaders: ['Content-Type', 'Authorization'], // Crucial para el token
    credentials: true,
};

// 1. Usar el middleware CORS 
app.use(cors(corsOptions));

// 2. Middleware para parsear cuerpos JSON
app.use(express.json());

// --- RUTAS DE API ---

// Ruta existente (Guardar Perfil)
app.post('/api/profile/save', saveProfileHandler);

// Ruta existente (Aprobación Admin)
app.post('/api/admin/aprobar-usuario', aprobarUsuarioHandler);

// 💡 CAMBIO 2: Definir la ruta POST para el endpoint de Motivación
app.post('/api/profile/motivation', motivationHandler);

//generacion del mesocyclo
app.post('/api/mesocycle/generate', motivationHandler);



// Ruta de estado
app.get('/', (req, res) => {
    res.status(200).json({
        status: 'OK',
        message: 'FitGen Backend Express/Nodemon operativo. CORS configurado.',
        dbStatus: db ? 'Firestore conectado' : 'Firestore ERROR',
        // 💡 CAMBIO 3: Actualizar el mensaje de bienvenida con el nuevo endpoint
        availableEndpoints: [
            'POST /api/profile/save',
            'POST /api/admin/aprobar-usuario',
            'POST /api/profile/motivation',
            'POST /api/mesocycle/generate'

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