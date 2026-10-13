export class HttpError extends Error {
  constructor(status, code, message, details = undefined) { super(message); this.status = status; this.code = code; this.details = details; }
}

export function permissionCentres(principal, permission) {
  const grants = principal.permissionCentres?.get(permission);
  if (grants) return grants.includes(null) ? null : grants;
  return principal.permissions?.has(permission) ? principal.centres : [];
}

export function hasPermission(principal, permission, centreId = undefined) {
  const centres = permissionCentres(principal, permission);
  if (centres === null) return true;
  if (centreId !== undefined) return centres.includes(centreId);
  return centres.length > 0;
}

export function assertPermission(principal, permission, centreId = undefined) {
  if (!hasPermission(principal, permission, centreId)) throw new HttpError(403, 'PERMISSION_DENIED', 'You do not have permission to perform this action.');
}

export function canAccessCentre(principal, centreId) {
  return principal.centres?.includes(null) || principal.centres?.includes(centreId) || false;
}

export function assertCentre(principal, centreId) {
  if (!principal.centres?.includes(null) && (!centreId || !canAccessCentre(principal, centreId))) {
    throw new HttpError(403, 'CENTRE_ACCESS_DENIED', 'This record is outside your assigned centre access.');
  }
}

export function requireCsrf(request) {
  const cookie = request.cookies.rhc_csrf;
  const header = request.headers['x-csrf-token'];
  if (!cookie || !header || cookie !== header) throw new HttpError(403, 'CSRF_INVALID', 'The security token is missing or expired. Refresh the page and try again.');
}

export function parsePage(url) {
  const limit = Math.min(100, Math.max(1, Number(url.searchParams.get('limit') || 25)));
  const offset = Math.max(0, Number(url.searchParams.get('offset') || 0));
  if (!Number.isInteger(limit) || !Number.isInteger(offset)) throw new HttpError(400, 'INVALID_PAGINATION', 'Pagination values must be whole numbers.');
  return { limit, offset };
}

export function validateName(value, field = 'firstName') {
  if (typeof value !== 'string' || !value.trim() || value.trim().length > 120) {
    throw new HttpError(400, 'INVALID_FIELD', `${field} is required and must be 120 characters or fewer.`);
  }
  return value.trim();
}

export function validateLeadTransition(from, to) {
  const allowed = {
    NEW: ['CONTACTED', 'INTERESTED', 'FOLLOW_UP', 'CONVERTED', 'LOST'],
    CONTACTED: ['INTERESTED', 'FOLLOW_UP', 'CONVERTED', 'LOST'],
    INTERESTED: ['FOLLOW_UP', 'CONVERTED', 'LOST'],
    FOLLOW_UP: ['CONTACTED', 'INTERESTED', 'CONVERTED', 'LOST'],
    CONVERTED: [], LOST: ['NEW', 'CONTACTED']
  };
  if (from !== to && !allowed[from]?.includes(to)) throw new HttpError(409, 'INVALID_LEAD_TRANSITION', `Lead cannot move from ${from} to ${to}.`);
}
