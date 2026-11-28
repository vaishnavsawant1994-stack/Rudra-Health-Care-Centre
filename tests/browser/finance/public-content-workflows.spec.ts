import { expect, test } from "@playwright/test";

const viewports = [
  { name: "desktop", width: 1280, height: 900 },
  { name: "tablet", width: 768, height: 1024 },
  { name: "mobile", width: 390, height: 844 },
] as const;

const noHorizontalOverflow = async (page: import("@playwright/test").Page) =>
  expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);

test("homepage search and About navigation reach published information at desktop, tablet and mobile", async ({ page }) => {
  const itemName = "Synthetic public booking browser item";

  for (const viewport of viewports) {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    const homeResponse = await page.goto("/");
    expect(homeResponse?.status(), `homepage response at ${viewport.name}`).toBe(200);
    await expect(page.getByRole("main")).toBeVisible();
    await expect(page.getByRole("heading", { level: 1, name: "Diagnostic Care, With Clear Next Steps" })).toBeVisible();
    await page.getByLabel("Search tests").fill(itemName);
    await page.getByLabel("Search tests").press("Enter");
    await expect(page).toHaveURL(/\/tests\?q=/);
    await expect(page.getByRole("heading", { level: 1, name: "Diagnostic Tests" })).toBeVisible();
    await expect(page.locator(".ref-directory-card").filter({ hasText: itemName })).toBeVisible();
    await noHorizontalOverflow(page);

    const aboutResponsePromise = page.waitForResponse((response) => response.url().endsWith("/about") && response.request().resourceType() === "document");
    await page.getByRole("navigation", { name: "About Rudra" }).getByRole("link", { name: "About Rudra", exact: true }).click();
    const aboutResponse = await aboutResponsePromise;
    expect(aboutResponse.status(), `About route response at ${viewport.name}`).toBe(200);
    await expect(page.getByRole("heading", { level: 1, name: "About Rudra Health Care Centre" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Rudra and Metropolis Healthcare" })).toBeVisible();
    await expect(page.getByText("Partner and accreditation claims require authorization", { exact: true })).toBeVisible();
    await expect(page.getByRole("link", { name: "Contact Rudra", exact: true })).toHaveAttribute("href", "/contact");
    await noHorizontalOverflow(page);
  }
});

test("home collection area information and FAQ controls preserve safe request wording and keyboard navigation", async ({ page }) => {
  const centreId = process.env.FINANCE_BROWSER_PUBLIC_CENTRE_ID;
  expect(centreId).toBeTruthy();

  for (const viewport of viewports) {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    const homeCollectionResponse = await page.goto("/home-collection");
    expect(homeCollectionResponse?.status(), `home collection route at ${viewport.name}`).toBe(200);
    await expect(page.getByRole("heading", { level: 1, name: "Diagnostic care, arranged around your day" })).toBeVisible();
    await expect(page.getByText(/Coverage, service eligibility, staffing and timing are checked before anything is confirmed/)).toBeVisible();
    await expect(page.getByText("This page does not confirm availability.", { exact: true })).toBeVisible();
    await page.getByRole("link", { name: "Search service areas" }).click();
    await expect(page).toHaveURL(/\/service-areas$/);
    await expect(page.getByRole("heading", { name: "Published service areas" })).toBeVisible();
    await expect(page.getByText(/A listed area does not confirm availability, an appointment, a test or a price/)).toBeVisible();
    const areaSearch = page.getByLabel("Search service areas or centres");
    await areaSearch.fill("Synthetic Test District");
    const centre = page.locator(".public-centres-list li").filter({ hasText: "Synthetic Finance Centre A" });
    await expect(centre).toBeVisible();
    await expect(centre).toContainText("Published service area: Synthetic Test District");
    await centre.getByRole("link", { name: "Request home collection" }).click();
    await expect(page).toHaveURL(new RegExp(`/book\\?centreId=${centreId}.*visitType=HOME_COLLECTION`));
    await expect(page.getByRole("combobox", { name: "Centre", exact: true })).toHaveValue(centreId!);
    await expect(page.getByRole("radio", { name: "Home collection request" })).toBeChecked();
    await expect(page.getByText(/Home collection requests require staff to confirm serviceability, availability and final charge/)).toBeVisible();
    await expect(page.getByText("Requested timing is not a reserved or confirmed slot.", { exact: true })).toBeVisible();
    await noHorizontalOverflow(page);

    const faqResponse = await page.goto("/faq");
    expect(faqResponse?.status(), `FAQ route at ${viewport.name}`).toBe(200);
    await expect(page.getByRole("heading", { level: 1, name: "How can we help you?" })).toBeVisible();
    const faqSearch = page.getByLabel("Search questions");
    await faqSearch.focus();
    await faqSearch.fill("Does a booking request confirm an appointment?");
    await expect(page.getByRole("status")).toContainText("1 answer found");
    await expect(page.locator(".public-faq dd")).toContainText("It does not create an appointment, reserve a slot, confirm a fee or start payment.");
    const shortcut = page.locator(".ref-faq-popular-list").getByRole("link", { name: "Does a booking request confirm an appointment?" });
    const target = await shortcut.getAttribute("href");
    expect(target).toMatch(/^#faq-/);
    await shortcut.focus();
    await page.keyboard.press("Enter");
    await expect.poll(() => new URL(page.url()).hash).toBe(target);
    await page.getByLabel("Topic").selectOption("Privacy");
    await expect(page.getByRole("status")).toContainText("0 answers found");
    await expect(page.getByText("No answers match those filters. Try another topic or search term.")).toBeVisible();
    await noHorizontalOverflow(page);
  }
});
