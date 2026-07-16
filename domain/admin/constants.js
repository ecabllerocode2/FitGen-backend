/** Firebase Auth UID allowed to access admin overview APIs. */
export const ADMIN_UID = 'jSM4TdWES2bzdtbAom7Bl2Q0tEb2';

export function assertAdminUid(uid) {
  if (uid !== ADMIN_UID) {
    throw Object.assign(new Error('No autorizado'), { status: 403 });
  }
}
