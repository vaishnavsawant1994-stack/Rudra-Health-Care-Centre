import { createElement, type ComponentType } from "react";
import type { Metadata } from "next";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import P001, { metadata as m001 } from "./page";
import P002, { metadata as m002 } from "./profile/page";
import P003, { metadata as m003 } from "./family/page";
import P004, { metadata as m004 } from "./family/[memberId]/page";
import P005, { metadata as m005 } from "./orders/[orderId]/journey/page";
import P006, { metadata as m006 } from "./appointments/page";
import P007, { metadata as m007 } from "./appointments/[appointmentId]/change/page";
import P008, { metadata as m008 } from "./orders/page";
import P009, { metadata as m009 } from "./reports/page";
import P010, { metadata as m010 } from "./billing/page";
import P011, { metadata as m011 } from "./addresses/page";
import P012, { metadata as m012 } from "./calendar/page";
import P013, { metadata as m013 } from "./support/page";
import P014, { metadata as m014 } from "./notifications/page";
import P015, { metadata as m015 } from "./health-documents/page";
import P016, { metadata as m016 } from "./health-trends/page";

const routes: Array<[string, ComponentType, Metadata]> = [
  ["P001", P001, m001], ["P002", P002, m002], ["P003", P003, m003], ["P004", P004, m004], ["P005", P005, m005], ["P006", P006, m006], ["P007", P007, m007], ["P008", P008, m008],
  ["P009", P009, m009], ["P010", P010, m010], ["P011", P011, m011], ["P012", P012, m012], ["P013", P013, m013], ["P014", P014, m014], ["P015", P015, m015], ["P016", P016, m016],
];

describe("Phase 02 canonical patient portal routes", () => {
  it.each(routes)("serves %s with the noindex patient-access gate", (screenId, Page, metadata) => {
    const html = renderToStaticMarkup(createElement(Page));
    expect(metadata.robots).toEqual({ index: false, follow: false });
    expect(html).toContain(screenId);
    expect(html).toContain("Patient access unavailable");
  });
});
