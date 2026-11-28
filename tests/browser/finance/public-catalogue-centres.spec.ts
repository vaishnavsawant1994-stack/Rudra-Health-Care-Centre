import pg from "pg";
import { expect, test } from "@playwright/test";

const viewports = [
  { name: "desktop", width: 1280, height: 900 },
  { name: "tablet", width: 768, height: 1024 },
  { name: "mobile", width: 390, height: 844 },
] as const;

const noOverflow = async (page: import("@playwright/test").Page) =>
  expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);

test("published test catalogue searches, filters, retries and carries the exact item into a booking request", async ({ page }) => {
  test.setTimeout(120_000);
  const centreId = process.env.FINANCE_BROWSER_PUBLIC_CENTRE_ID;
  const itemId = process.env.FINANCE_BROWSER_PUBLIC_BOOKING_CATALOGUE_ITEM_ID;
  const databaseUrl = process.env.DATABASE_TEST_URL;
  expect(centreId && itemId && databaseUrl).toBeTruthy();
  const database = new pg.Pool({ connectionString: databaseUrl, max: 1 });
  let injectedFailure = false;
  await page.route("**/api/public/catalogue?**", async (route) => {
    const requestUrl = new URL(route.request().url());
    if (!injectedFailure && requestUrl.searchParams.get("q") === "SYNTHETIC_CATALOGUE_RETRY") {
      injectedFailure = true;
      await route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ error: "public_catalogue_unavailable" }) });
      return;
    }
    await route.continue();
  });

  try {
    const stored = await database.query(
      `SELECT i.public_visible, i.active, i.current_version, v.version_number, v.verification_status, v.price_amount::text, v.effective_from::text
       FROM diagnostic_catalogue_items i JOIN diagnostic_catalogue_versions v ON v.catalogue_item_id=i.id
       WHERE i.id=$1`, [itemId],
    );
    expect(stored.rowCount).toBe(1);
    expect(stored.rows[0]).toMatchObject({ public_visible: true, active: true, current_version: 1, version_number: 1, verification_status: "VERIFIED", price_amount: "125.00" });

    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto(`/tests?centreId=${centreId}`);
    await expect(page.getByRole("heading", { level: 1, name: "Diagnostic Tests" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Search", exact: true })).toBeEnabled();
    const search = page.getByLabel("Search services");
    await search.fill("SYNTHETIC_CATALOGUE_RETRY");
    await search.press("Enter");
    await expect(page.getByRole("status")).toContainText("temporarily unavailable");
    await page.getByRole("button", { name: "Retry catalogue" }).click();
    await expect(page.getByRole("status")).toContainText("No currently published, verified services");

    for (const viewport of viewports) {
      await page.setViewportSize({ width: viewport.width, height: viewport.height });
      await page.goto(`/tests?centreId=${centreId}`);
      await expect(page.getByRole("combobox", { name: "Centre", exact: true })).toHaveValue(centreId!);
      const query = page.getByLabel("Search services");
      await query.fill("Synthetic public booking browser item");
      await query.press("Enter");
      const card = page.locator(".ref-directory-card").filter({ hasText: "Synthetic public booking browser item" });
      await expect(card).toBeVisible();
      await expect(card).toContainText("125.00");
      await expect(card).toContainText("Synthetic Finance Centre A");
      await noOverflow(page);

      await card.getByRole("link", { name: "View details" }).click();
      await expect(page.getByRole("heading", { level: 1, name: "Synthetic public booking browser item" })).toBeVisible();
      await expect(page.getByText("Synthetic specimen requirement", { exact: true })).toBeVisible();
      await expect(page.getByText("Synthetic preparation guidance", { exact: true })).toBeVisible();
      await page.getByRole("link", { name: "Request this service" }).click();
      await expect(page).toHaveURL(/\/book\?/);
      await expect(page.getByRole("combobox", { name: "Centre", exact: true })).toHaveValue(centreId!);
      await expect(page.getByLabel(/Synthetic public booking browser item/)).toBeChecked();
      await expect(page.locator(".r-book-service-option").filter({ hasText: "Synthetic public booking browser item" })).toContainText("published version 1");
      await noOverflow(page);
    }
  } finally {
    await database.end();
  }
});

test("published package details, centre discovery and service filters work with safe retry states", async ({ page }) => {
  test.setTimeout(120_000);
  const centreId = process.env.FINANCE_BROWSER_PUBLIC_CENTRE_ID;
  const packageId = process.env.FINANCE_BROWSER_PUBLIC_PACKAGE_ITEM_ID;
  const includedTestId = process.env.FINANCE_BROWSER_PUBLIC_BOOKING_CATALOGUE_ITEM_ID;
  const databaseUrl = process.env.DATABASE_TEST_URL;
  expect(centreId && packageId && includedTestId && databaseUrl).toBeTruthy();
  const database = new pg.Pool({ connectionString: databaseUrl, max: 1 });
  let directoryFailed = false;
  let servicesFailed = false;
  await page.route("**/api/public/centres", async (route) => {
    if (!directoryFailed) {
      directoryFailed = true;
      await route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ error: "public_centres_unavailable" }) });
      return;
    }
    await route.continue();
  });
  await page.route("**/api/public/catalogue?**", async (route) => {
    const requestUrl = new URL(route.request().url());
    if (!servicesFailed && requestUrl.searchParams.get("q") === "SYNTHETIC_CENTRE_RETRY") {
      servicesFailed = true;
      await route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ error: "public_catalogue_unavailable" }) });
      return;
    }
    await route.continue();
  });

  try {
    const component = await database.query(
      `SELECT package.id, component.test_version_id
       FROM diagnostic_catalogue_items package
       JOIN diagnostic_catalogue_versions package_version ON package_version.catalogue_item_id=package.id AND package_version.version_number=package.current_version
       JOIN diagnostic_package_components component ON component.package_version_id=package_version.id
       JOIN diagnostic_catalogue_items test_item ON test_item.id=$2
       WHERE package.id=$1 AND component.test_version_id=(SELECT id FROM diagnostic_catalogue_versions WHERE catalogue_item_id=test_item.id AND version_number=test_item.current_version)`,
      [packageId, includedTestId],
    );
    expect(component.rowCount).toBe(1);

    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto(`/packages?centreId=${centreId}`);
    await expect(page.getByRole("heading", { level: 1, name: "Health Checkup Packages" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Search", exact: true })).toBeEnabled();
    await page.getByLabel("Search services").fill("Synthetic public package browser item");
    await page.getByRole("button", { name: "Search", exact: true }).click();
    const publicPackage = page.locator(".ref-directory-card").filter({ hasText: "Synthetic public package browser item" });
    await expect(publicPackage).toBeVisible();
    await expect(publicPackage).toContainText("325.00");
    await publicPackage.getByRole("button", { name: "Compare package" }).click();
    await expect(page.getByRole("region", { name: "Package comparison" })).toContainText("Synthetic public package browser item");
    await expect(page.getByRole("region", { name: "Package comparison" })).toContainText("325.00");
    await noOverflow(page);

    await page.goto("/centres");
    await expect(page.getByRole("status")).toContainText("temporarily unavailable");
    await page.getByRole("button", { name: "Retry centre directory" }).click();
    const centreCard = page.locator(".public-centres-list li").filter({ hasText: "Synthetic Finance Centre A" });
    await expect(centreCard).toBeVisible();
    await expect(centreCard).toContainText("100 Synthetic Test Road, Test City");
    await expect(centreCard.getByRole("link", { name: "Directions to Synthetic Finance Centre A using the published address" })).toHaveAttribute("href", /google\.com\/maps\/dir/);
    const centreSearch = page.getByLabel("Search centres");
    await centreSearch.fill("NO_MATCH_SYNTHETIC_CENTRE");
    await expect(page.getByRole("status")).toContainText("No published centres match this search");
    await centreSearch.fill("Synthetic Finance Centre A");
    await expect(centreCard).toBeVisible();

    await page.goto(`/centres/${centreId}`);
    await expect(page.getByRole("heading", { level: 1, name: "Synthetic Finance Centre A" })).toBeVisible();
    await page.getByLabel("Search services").fill("SYNTHETIC_CENTRE_RETRY");
    await page.getByRole("button", { name: "Search", exact: true }).click();
    await expect(page.getByRole("status")).toContainText("could not be loaded");
    await page.getByRole("button", { name: "Retry published services" }).click();
    await expect(page.getByRole("status")).toContainText("No published services match these filters");

    for (const viewport of viewports) {
      await page.setViewportSize({ width: viewport.width, height: viewport.height });
      await page.goto("/centres");
      const listing = page.locator(".public-centres-list li").filter({ hasText: "Synthetic Finance Centre A" });
      await expect(listing).toBeVisible();
      await listing.getByRole("link", { name: "View centre" }).click();
      await expect(page).toHaveURL(new RegExp(`/centres/${centreId}`));
      await expect(page.getByRole("heading", { level: 1, name: "Synthetic Finance Centre A" })).toBeVisible();
      await expect(page.getByText("Service area: Synthetic Test District", { exact: true })).toBeVisible();
      await expect(page.getByText(/staff must confirm home-collection coverage/)).toBeVisible();
      const serviceFilter = page.getByLabel("Service type");
      await serviceFilter.selectOption("PACKAGE");
      const packageRow = page.locator(".public-service-list li").filter({ hasText: "Synthetic public package browser item" });
      await expect(packageRow).toBeVisible();
      await expect(packageRow).toContainText("325.00");
      await expect(page.getByRole("button", { name: "Next" })).toBeDisabled();
      await packageRow.getByRole("link", { name: "Service details" }).click();
      await expect(page.getByRole("heading", { level: 1, name: "Synthetic public package browser item" })).toBeVisible();
      await expect(page.getByRole("heading", { name: "Included tests" })).toBeVisible();
      await expect(page.getByText("Synthetic public booking browser item")).toBeVisible();
      await page.getByRole("link", { name: "Request this service" }).click();
      await expect(page.getByRole("combobox", { name: "Centre", exact: true })).toHaveValue(centreId!);
      await expect(page.getByLabel(/Synthetic public package browser item/)).toBeChecked();
      await noOverflow(page);
    }
  } finally {
    await database.end();
  }
});
