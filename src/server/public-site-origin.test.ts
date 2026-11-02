import { describe, expect, it } from "vitest";
import { publicSiteOrigin } from "./public-site-origin";

describe("public site origin", () => {
  it("uses the explicit canonical URL and strips a trailing slash", () => {
    expect(publicSiteOrigin({ NODE_ENV: "production", PUBLIC_SITE_URL: "https://rudra.example/" } as NodeJS.ProcessEnv)).toBe("https://rudra.example");
  });

  it("rejects credentials, paths, queries, fragments, and insecure production origins", () => {
    for (const value of ["https://user:pass@rudra.example", "https://rudra.example/app", "https://rudra.example/?x=1", "https://rudra.example/#top", "http://rudra.example"]) {
      expect(publicSiteOrigin({ NODE_ENV: "production", PUBLIC_SITE_URL: value } as NodeJS.ProcessEnv)).toBeNull();
    }
  });

  it("uses the local auth origin only in development and never invents a production host", () => {
    expect(publicSiteOrigin({ NODE_ENV: "development", BETTER_AUTH_URL: "http://localhost:3000" } as NodeJS.ProcessEnv)).toBe("http://localhost:3000");
    expect(publicSiteOrigin({ NODE_ENV: "production", BETTER_AUTH_URL: "https://auth.rudra.example" } as NodeJS.ProcessEnv)).toBeNull();
    expect(publicSiteOrigin({ NODE_ENV: "test" } as NodeJS.ProcessEnv)).toBe("http://localhost:3000");
  });
});
