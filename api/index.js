// api/index.js

import express from 'express';
import cors from 'cors';
import { db, auth } from '../lib/firebaseAdmin.js'; 
import saveProfileHandler from './profile/save.js'; 
import aprobarUsuarioHandler from './admin/aprobar-usuario.js'; 

const app = express();

// Middleware de CORS, Body Parser, etc., MANTENIENDO TU LÓGICA
app.use(cors({ 
    origin: '*', 
    methods: ['GET', 'POST', 'OPTIONS'], 
    allowedHeaders: ['Content-Type', 'Authorization'] 
})); 
app.use(express.json());

// --- RUTAS DE API ---
// Usa el archivo handler directamente
app.post('/api/profile/save', saveProfileHandler); 
app.post('/api/admin/aprobar-usuario', aprobarUsuarioHandler); 

// Ruta de estado
app.get('/', (req, res) => {
    res.status(200).json({ 
        status: 'OK',
        message: 'FitGen Backend (Vercel Handler) operativo.',
        dbStatus: db ? 'Firestore conectado' : 'Firestore ERROR',
        availableEndpoints: ['POST /api/profile/save', 'POST /api/admin/aprobar-usuario']
    });
});

// 💡 EXPORTACIÓN CRÍTICA: Exportar la aplicación Express para Vercel
// Vercel buscará un 'handler' exportado, y con Express, necesita la app.
// Si esto no funciona, deberás usar el patrón de "micro" (Paso 2).
export default app;