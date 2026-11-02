import { describe, expect, it } from "vitest";
import { filterPublicFaq, type PublicFaqItem } from "./public-faq";

const items: PublicFaqItem[] = [
  { question: "Are listed prices current?", answer: "Only verified catalogue prices are shown.", topic: "Services" },
  { question: "Does this site confirm an appointment?", answer: "No, requests are reviewed by staff.", topic: "Booking" },
  { question: "Can family access another report?", answer: "A relationship alone never grants access.", topic: "Privacy" },
];

describe("public FAQ search", () => {
  it("matches question, answer, and topic case-insensitively", () => {
    expect(filterPublicFaq(items, "VERIFIED", "ALL")).toEqual([items[0]]);
    expect(filterPublicFaq(items, "privacy", "ALL")).toEqual([items[2]]);
  });

  it("combines topic and text filters and handles whitespace and no matches", () => {
    expect(filterPublicFaq(items, "  staff ", "Booking")).toEqual([items[1]]);
    expect(filterPublicFaq(items, "report", "Booking")).toEqual([]);
    expect(filterPublicFaq(items, "   ", "Privacy")).toEqual([items[2]]);
  });
});
