export type PublicCookiePreferences = { analytics: boolean; marketing: boolean };

export const publicCookiePreferencesKey = "rudra.public-cookie-preferences.v1";

export function serializePublicCookiePreferences(value: PublicCookiePreferences) {
  return JSON.stringify({ version: 1, analytics: value.analytics, marketing: value.marketing });
}

export function parsePublicCookiePreferences(value: string | null): PublicCookiePreferences | null {
  if (!value || value.length > 500) return null;
  try {
    const parsed: unknown = JSON.parse(value);
    if (typeof parsed !== "object" || parsed === null) return null;
    const candidate = parsed as Record<string, unknown>;
    if (candidate.version !== 1 || typeof candidate.analytics !== "boolean" || typeof candidate.marketing !== "boolean") return null;
    return { analytics: candidate.analytics, marketing: candidate.marketing };
  } catch {
    return null;
  }
}
