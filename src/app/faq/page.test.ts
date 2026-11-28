import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { FaqContent } from "./page";

describe("public FAQ guidance handoff", () => {
  it("links to the fixed-choice service guide without presenting it as AI or medical advice", () => {
    const markup = renderToStaticMarkup(createElement(FaqContent, { items: [] }));

    expect(markup).toContain('href="/chat"');
    expect(markup).toContain("Open Rudra service guide");
    expect(markup).toContain("not an AI or medical-advice service");
    expect(markup).toContain("Frequently asked questions");
  });

  it("takes each common-question link to its matching answer", () => {
    const items = [
      { question: "How do I request a visit?", answer: "Send an enquiry for staff review.", topic: "Booking" },
      { question: "Can I access reports?", answer: "Patient report access is not active.", topic: "Privacy" },
    ];
    const markup = renderToStaticMarkup(createElement(FaqContent, { items }));

    expect(markup).toContain('href="#faq-answer-1"');
    expect(markup).toContain('href="#faq-answer-2"');
    expect(markup).toContain('id="faq-answer-1"');
    expect(markup).toContain('id="faq-answer-2"');
    expect(markup).not.toContain('href="#faq-answers">How do I request a visit?');
  });
});
