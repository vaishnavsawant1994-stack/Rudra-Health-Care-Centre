import { describe, expect, it } from "vitest";
import { parsePublicCookiePreferences, publicCookiePreferencesKey, serializePublicCookiePreferences } from "./public-cookie-preferences";

describe("public cookie preference storage", () => {
  it("parses only versioned boolean preference categories", () => {
    expect(parsePublicCookiePreferences('{"version":1,"analytics":false,"marketing":true}')).toEqual({ analytics: false, marketing: true });
    expect(parsePublicCookiePreferences('{"version":2,"analytics":true,"marketing":false}')).toBeNull();
    expect(parsePublicCookiePreferences('{"version":1,"analytics":"yes","marketing":false}')).toBeNull();
    expect(parsePublicCookiePreferences("not json")).toBeNull();
    expect(parsePublicCookiePreferences(null)).toBeNull();
  });

  it("uses an explicit Rudra-owned storage key", () => {
    expect(publicCookiePreferencesKey).toBe("rudra.public-cookie-preferences.v1");
    expect(serializePublicCookiePreferences({ analytics: true, marketing: false })).toBe('{"version":1,"analytics":true,"marketing":false}');
  });
});
