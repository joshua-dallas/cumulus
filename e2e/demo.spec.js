import { test, expect } from "@playwright/test";

// The demo page: the seed field shows the seed of the cloud on show, and typing a new
// seed builds a new cloud that grows in again

test.beforeEach(async ({ page }) => {
  await page.goto("/demo/");
  await page.evaluate(() => customElements.whenDefined("cumulus-canvas"));
});

const cloud = (page) => page.locator("cumulus-canvas");

test("the seed field starts with the seed of the cloud", async ({ page }) => {
  await expect(page.locator("#seed")).toHaveValue("227805");
  expect(await cloud(page).evaluate((el) => el.currentSeed)).toBe(227805);
});

test("clicking the cloud shows its new seed in the field", async ({ page }) => {
  await page.waitForTimeout(1500); // let it grow in, as a click is ignored while it shrinks
  await cloud(page).click({ position: { x: 300, y: 250 } });
  await expect(page.locator("#seed")).not.toHaveValue("227805");
  const shown = await page.locator("#seed").inputValue();
  expect(await cloud(page).evaluate((el) => String(el.currentSeed))).toBe(shown);
});

test("typing a seed makes a new cloud element with that seed (and growIn, so it grows in again)", async ({
  page,
}) => {
  await page.evaluate(() => (window.oldCloud = document.querySelector("cumulus-canvas")));
  await page.locator("#seed").fill("42");
  await page.locator("#seed").press("Enter");

  await expect.poll(() => cloud(page).evaluate((el) => el.currentSeed)).toBe(42);
  await expect(page.locator("#seed")).toHaveValue("42");
  // A new element, so the grow-in plays again
  expect(
    await page.evaluate(() => window.oldCloud !== document.querySelector("cumulus-canvas")),
  ).toBe(true);
  expect(await cloud(page).evaluate((el) => el.hasAttribute("growin"))).toBe(true);
  expect(await page.locator("cumulus-canvas").count()).toBe(1);
});

test("something that is not a number puts the current seed back", async ({ page }) => {
  await page.locator("#seed").evaluate((input) => {
    input.type = "text"; // a number field would not accept the text at all
    input.value = "cloud";
    input.dispatchEvent(new Event("change"));
  });
  await expect(page.locator("#seed")).toHaveValue("227805");
  expect(await cloud(page).evaluate((el) => el.currentSeed)).toBe(227805);
});

test("a cloud rebuilt for a typed seed keeps the sunset", async ({ page }) => {
  await page.locator("#sunset-button").click();
  await page.locator("#seed").fill("7");
  await page.locator("#seed").press("Enter");
  await expect.poll(() => cloud(page).evaluate((el) => el.currentSeed)).toBe(7);
  expect(await cloud(page).evaluate((el) => el.hasAttribute("sunset"))).toBe(true);
});
