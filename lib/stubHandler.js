/**
 * Stub handler para endpoints pendientes de reconstrucción (Fase 4).
 * Conserva la firma de ruta en server.js sin ejecutar lógica obsoleta.
 */
export function createStubHandler(endpointName) {
    return async function handler(req, res) {
        if (req.method !== 'POST') {
            return res.status(405).json({ error: 'Método no permitido. Solo POST.' });
        }
        return res.status(501).json({
            status: 'not_implemented',
            message: `El endpoint ${endpointName} está en reconstrucción según el DDS v1.0.`,
            endpoint: endpointName,
        });
    };
}
