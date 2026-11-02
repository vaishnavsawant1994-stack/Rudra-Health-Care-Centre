import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ApprovalDeadlineProcessor } from "./approval-deadline-processor";

describe("approval deadline processor control", () => {
  it("explains the task-only expiry/escalation action and its limits", () => {
    const markup = renderToStaticMarkup(createElement(ApprovalDeadlineProcessor));

    expect(markup).toContain("Process due approvals now");
    expect(markup).toContain("authorized centres");
    expect(markup).toContain("does not approve or reject a task");
    expect(markup).toContain('role="status"');
  });
});
