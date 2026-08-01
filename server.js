import express from 'express';
import cors from 'cors';
// Nota: Importar db y auth aquí asegura que Firebase Admin se inicialice al iniciar el servidor
import { db, auth } from './lib/firebaseAdmin.js';

// --- IMPORTACIÓN DE HANDLERS ---
import saveProfileHandler from './api/profile/save.js';
import aprobarUsuarioHandler from './api/admin/aprobar-usuario.js';
import motivationHandler from './api/profile/motivation.js';
import mesocycleGenerateHandler from './api/mesocycle/generate.js'; 
import mesocycleEvaluateHandler from './api/mesocycle/evaluate.js'; // 👈 NUEVA IMPORTACIÓN
// import sessionGenerateHandler from './api/session/generate.js'; // Removed: deprecated
import sessionGenerateV2Handler from './api/session/generateV2.js'; 
import sessionCompleteHandler from './api/session/complete.js';
import sessionCelebrationCardHandler from './api/session/celebration-card.js';
import sessionCelebrationsHandler from './api/session/celebrations.js';
import sessionHistoryHandler from './api/session/history.js';
import sessionDiscardStaleHandler from './api/session/discard-stale.js';
import sessionSwapHandler from './api/session/swap-exercise.js'; 
import sessionSwapWarmupHandler from './api/session/swap-warmup-exercise.js';
import exercisePreferencesHandler from './api/profile/exercise-preferences.js';
import gamificationSummaryHandler from './api/gamification/summary.js';
import gamificationLeaderboardHandler from './api/gamification/leaderboard.js';
import gamificationOptInLeaderboardHandler from './api/gamification/opt-in-leaderboard.js';
import gamificationEquipHandler from './api/gamification/equip.js';
import shopPurchaseHandler from './api/shop/purchase.js';
import shopRedeemPremiumHandler from './api/shop/redeem-premium.js';
import adminUsersOverviewHandler from './api/admin/users-overview.js';
import adminUserDetailHandler from './api/admin/user-detail.js';
import adminUsersDashboardListHandler from './api/admin/users-dashboard-list.js';
import adminUserDashboardHandler from './api/admin/user-dashboard.js';
import adminCoachSetPlanHandler from './api/admin/coach-set-plan.js';
import bodyMetricsCheckinHandler from './api/body-metrics/checkin.js';
import coachRegisterHandler from './api/coach/register.js';
import coachMeHandler from './api/coach/me.js';
import coachInvitesHandler from './api/coach/invites.js';
import coachInvitesRevokeHandler from './api/coach/invites-revoke.js';
import coachClientsHandler from './api/coach/clients.js';
import coachClientDetailHandler from './api/coach/client-detail.js';
import coachClientSessionDetailHandler from './api/coach/client-session-detail.js';
import coachClientTrainingProfileHandler from './api/coach/client-training-profile.js';
import coachClientMesocycleGenerateHandler from './api/coach/client-mesocycle-generate.js';
import coachClientReleaseHandler from './api/coach/client-release.js';
import coachClientNotesHandler from './api/coach/client-notes.js';
import coachClientInsightsHandler from './api/coach/client-insights.js';
import coachClientSwapExerciseHandler from './api/coach/client-swap-exercise.js';
import coachClientExercisePreferencesHandler from './api/coach/client-exercise-preferences.js';
import joinLookupHandler from './api/join/lookup.js';
import joinAcceptHandler from './api/join/accept.js';
import athleteShareBrandingHandler from './api/athlete/share-branding.js';
import billingStatusHandler from './api/billing/status.js';
import billingCreateSubscriptionHandler from './api/billing/mp/create-subscription.js';
import billingMpWebhookHandler from './api/billing/mp/webhook.js';
import billingMpSyncHandler from './api/billing/mp/sync.js';

const app = express();
const PORT = 3000;

// 💡 CONFIGURACIÓN CORS ROBUSTA
// Reflect request Origin (never ACAO:* with credentials — Safari rejects that combo).
const corsOptions = {
    origin: true,
    methods: ['GET', 'POST', 'PATCH', 'OPTIONS'],
    allowedHeaders: [
        'Content-Type',
        'Authorization',
        'x-vercel-protection-bypass',
        'x-vercel-set-bypass-cookie',
    ],
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

// Evaluación del Mesociclo (NUEVA RUTA)
app.post('/api/mesocycle/evaluate', mesocycleEvaluateHandler); // 👈 RUTA AÑADIDA

// Generación del Mesociclo
app.post('/api/mesocycle/generate', mesocycleGenerateHandler);

// Generación de la Sesión del Día
// app.post('/api/session/generate', sessionGenerateHandler); // Removed: deprecated

// Generación de la Sesión V2 (Nueva versión mejorada)
app.post('/api/session/generateV2', sessionGenerateV2Handler);

// Completar Sesión (Guardar Feedback e Historial)
app.post('/api/session/complete', sessionCompleteHandler);

// Tarjetas de celebración (R2, 30 días)
app.post('/api/session/celebration-card', sessionCelebrationCardHandler);
app.get('/api/session/celebrations', sessionCelebrationsHandler);
app.get('/api/session/history', sessionHistoryHandler);
app.post('/api/session/discard-stale', sessionDiscardStaleHandler);

// 🔄 RUTA PARA INTERCAMBIO DE EJERCICIOS (SWAP)
app.post('/api/session/swap-exercise', sessionSwapHandler);
app.post('/api/session/swap-warmup-exercise', sessionSwapWarmupHandler);
app.post('/api/profile/exercise-preferences', exercisePreferencesHandler);
app.get('/api/body-metrics/checkin', bodyMetricsCheckinHandler);
app.post('/api/body-metrics/checkin', bodyMetricsCheckinHandler);
app.get('/api/gamification/summary', gamificationSummaryHandler);
app.get('/api/gamification/leaderboard', gamificationLeaderboardHandler);
app.post('/api/gamification/opt-in-leaderboard', gamificationOptInLeaderboardHandler);
app.post('/api/gamification/equip', gamificationEquipHandler);
app.get('/api/shop/catalog', shopPurchaseHandler);
app.post('/api/shop/purchase', shopPurchaseHandler);
app.post('/api/shop/redeem-premium', shopRedeemPremiumHandler);
app.get('/api/admin/users-overview', adminUsersOverviewHandler);
app.get('/api/admin/user-detail', adminUserDetailHandler);
app.get('/api/admin/users-dashboard-list', adminUsersDashboardListHandler);
app.get('/api/admin/user-dashboard', adminUserDashboardHandler);
app.post('/api/admin/coach-set-plan', adminCoachSetPlanHandler);

// Coach platform
app.post('/api/coach/register', coachRegisterHandler);
app.get('/api/coach/me', coachMeHandler);
app.get('/api/coach/invites', coachInvitesHandler);
app.post('/api/coach/invites', coachInvitesHandler);
app.post('/api/coach/invites/revoke', coachInvitesRevokeHandler);
app.get('/api/coach/clients', coachClientsHandler);
app.get('/api/coach/clients/:athleteId/sessions/:sessionId', coachClientSessionDetailHandler);
app.get('/api/coach/clients/:athleteId', coachClientDetailHandler);
app.patch('/api/coach/clients/:athleteId/training-profile', coachClientTrainingProfileHandler);
app.post('/api/coach/clients/:athleteId/training-profile', coachClientTrainingProfileHandler);
app.post('/api/coach/clients/:athleteId/mesocycle/generate', coachClientMesocycleGenerateHandler);
app.post('/api/coach/clients/:athleteId/release', coachClientReleaseHandler);
app.get('/api/coach/clients/:athleteId/notes', coachClientNotesHandler);
app.post('/api/coach/clients/:athleteId/notes', coachClientNotesHandler);
app.get('/api/coach/clients/:athleteId/insights', coachClientInsightsHandler);
app.post('/api/coach/clients/:athleteId/swap-exercise', coachClientSwapExerciseHandler);
app.post('/api/coach/clients/:athleteId/exercise-preferences', coachClientExercisePreferencesHandler);
app.get('/api/join/:token', joinLookupHandler);
app.post('/api/join/:token/accept', joinAcceptHandler);
app.get('/api/athlete/share-branding', athleteShareBrandingHandler);

// Billing / Mercado Pago (athlete B2C)
app.get('/api/billing/status', billingStatusHandler);
app.post('/api/billing/mp/create-subscription', billingCreateSubscriptionHandler);
app.post('/api/billing/mp/sync', billingMpSyncHandler);
app.post('/api/billing/mp/webhook', billingMpWebhookHandler);
app.get('/api/billing/mp/webhook', billingMpWebhookHandler);

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
            'POST /api/mesocycle/evaluate',
            'POST /api/mesocycle/generate',
            // 'POST /api/session/generate',
            'POST /api/session/generateV2',
            'POST /api/session/complete',
            'POST /api/session/swap-exercise',
            'POST /api/session/swap-warmup-exercise',
            'POST /api/profile/exercise-preferences',
            'GET /api/body-metrics/checkin',
            'POST /api/body-metrics/checkin',
            'GET /api/admin/users-overview',
            'GET /api/admin/user-detail',
            'GET /api/admin/users-dashboard-list',
            'GET /api/admin/user-dashboard',
            'GET /api/billing/status',
            'POST /api/billing/mp/create-subscription',
            'POST /api/billing/mp/webhook',
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