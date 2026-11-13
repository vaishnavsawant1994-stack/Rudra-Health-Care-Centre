import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

const redirect = vi.hoisted(() => vi.fn());
vi.mock("next/navigation", () => ({ redirect }));

import TrackPage from "./page";

describe("public tracking canonical route", () => {
  it("forwards /track to the existing restricted tracking entry", () => {
    redirect.mockClear();
    renderToStaticMarkup(createElement(TrackPage));
    expect(redirect).toHaveBeenCalledWith("/track-booking");
  });
});
