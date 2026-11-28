import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { DispatchBatchDetail, DispatchDesk } from "./sample-workbench";

describe("field-to-branch dispatch recovery controls", () => {
  it("exposes queue retry while dispatch data is loading", () => {
    const markup = renderToStaticMarkup(createElement(DispatchDesk, { grants: [] }));

    expect(markup).toContain("Retry dispatch queue");
    expect(markup).toContain("Loading dispatch queue");
  });

  it("exposes batch retry before a handover can be recorded", () => {
    const markup = renderToStaticMarkup(createElement(DispatchBatchDetail, {
      id: "synthetic-batch",
      grants: [],
    }));

    expect(markup).toContain("Retry batch details");
    expect(markup).toContain("Loading batch");
  });
});
