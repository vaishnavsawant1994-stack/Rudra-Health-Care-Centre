import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { PermissionGrant } from "@/server/permissions";
import { DispatchBatchQueue, filterDispatchBatchPage } from "./dispatch-batch-queue";

const batches = [
  { id: "batch-a", centreId: "centre-a", batchNumber: "SYN-A", status: "PREPARING", carrierReference: null, externalLabReference: null, handedOverAt: null, createdAt: "2026-11-17T00:00:00.000Z" },
  { id: "batch-b", centreId: "centre-a", batchNumber: "SYN-B", status: "DISPATCHED", carrierReference: "synthetic-carrier", externalLabReference: null, handedOverAt: "2026-11-17T00:00:00.000Z", createdAt: "2026-11-17T00:00:00.000Z" },
  { id: "batch-c", centreId: "centre-b", batchNumber: "SYN-C", status: "RECEIPT_RECORDED", carrierReference: "synthetic-carrier", externalLabReference: "synthetic-receipt", handedOverAt: "2026-11-17T00:00:00.000Z", createdAt: "2026-11-17T00:00:00.000Z" },
];

describe("dispatch batch queue", () => {
  it("limits handover rows to prepared batches in the staff member's centre scope", () => {
    const grants: PermissionGrant[] = [{ key: "samples.read", centreId: "centre-a" }];

    expect(filterDispatchBatchPage(batches, "handover", grants).map((batch) => batch.id)).toEqual(["batch-a"]);
  });

  it("limits transit rows to dispatched or receipted batches in authorized centres", () => {
    const grants: PermissionGrant[] = [{ key: "samples.read", centreId: "centre-a" }];

    expect(filterDispatchBatchPage(batches, "transit", grants).map((batch) => batch.id)).toEqual(["batch-b"]);
  });

  it("renders explicit paging controls for server-paginated queues", () => {
    const markup = renderToStaticMarkup(createElement(DispatchBatchQueue, { mode: "handover", grants: [] }));

    expect(markup).toContain("Previous page");
    expect(markup).toContain("Next page");
    expect(markup).toContain("Page 1");
  });
});
