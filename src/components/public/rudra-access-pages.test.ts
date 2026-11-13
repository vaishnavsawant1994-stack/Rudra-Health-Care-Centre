import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";

vi.mock("next/link", () => ({ default: ({ href, children }: { href: string; children: ReactNode }) => createElement("a", { href }, children) }));

import { RudraAccessPage } from "./rudra-access-pages";

describe("restricted patient-facing screens", () => {
  it.each([
    ["tracking", "Public tracking is not connected yet", "No booking, patient or report data is being looked up"],
    ["reports", "Secure patient self-service is not enabled yet", "No booking, patient or report data is being looked up"],
    ["login", "Patient sign-in is not enabled", "Do not enter personal or medical information here"],
    ["register", "Patient registration is not enabled yet", "Do not enter personal or medical information here"],
  ] as const)("keeps %s unavailable until its required identity or service workflow is approved", (kind, restriction, safetyCopy) => {
    const html = renderToStaticMarkup(createElement(RudraAccessPage, { kind }));
    expect(html).toContain(restriction);
    expect(html).toContain('role="status"');
    expect(html).toContain(safetyCopy);
    expect(html).toContain("disabled");
    expect(html).not.toContain("value=\"SYN");
  });
});
