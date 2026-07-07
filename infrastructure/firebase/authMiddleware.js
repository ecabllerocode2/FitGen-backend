/**
 * Firebase Auth middleware — verifies Bearer token on API requests.
 * @param {import('firebase-admin/auth').Auth} auth — firebase-admin auth instance
 * @returns {function} Express middleware
 */
export function verifyFirebaseToken(auth) {
  return async function firebaseAuthMiddleware(req, res, next) {
    const header = req.headers.authorization ?? '';
    const match = header.match(/^Bearer\s+(.+)$/i);

    if (!match) {
      return res.status(401).json({ error: 'Missing or invalid Authorization header' });
    }

    try {
      const decoded = await auth.verifyIdToken(match[1]);
      req.user = {
        uid: decoded.uid,
        email: decoded.email ?? null,
      };
      return next();
    } catch (err) {
      return res.status(401).json({ error: 'Invalid or expired token', detail: err.message });
    }
  };
}
