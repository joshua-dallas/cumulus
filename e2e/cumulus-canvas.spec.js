import { test, expect } from "@playwright/test";

// Tests the <cumulus-canvas> element in a real browser: attributes, rebuilds, clicks,
// the sunset, reconnecting and reduced motion. The cloud is drawn in a worker on a
// transferred canvas, so the picture is read from a screenshot of the element.

const CLOUD = 'width="300" height="200" numCells="8"';

test.beforeEach(async ({ page }) => {
  await page.goto("/e2e/fixture.html");
  await page.evaluate(() => customElements.whenDefined("cumulus-canvas"));
});

// Puts an element on the page and returns its locator
async function add(page, attributes, id = "cloud") {
  await page.evaluate(
    ({ attributes, id }) => {
      document.body.insertAdjacentHTML(
        "beforeend",
        `<cumulus-canvas id="${id}" ${attributes}></cumulus-canvas>`,
      );
    },
    { attributes, id },
  );
  return page.locator(`#${id}`);
}

// How many pixels of a PNG are not plain white
async function inkOf(page, png) {
  return page.evaluate(async (base64) => {
    const image = new Image();
    image.src = `data:image/png;base64,${base64}`;
    await image.decode();
    const canvas = new OffscreenCanvas(image.width, image.height);
    const context = canvas.getContext("2d");
    context.drawImage(image, 0, 0);
    const { data } = context.getImageData(0, 0, image.width, image.height);
    let ink = 0;
    for (let i = 0; i < data.length; i += 4) {
      if (data[i] < 250 || data[i + 1] < 250 || data[i + 2] < 250) ink++;
    }
    return ink;
  }, png.toString("base64"));
}

// A screenshot taken once the picture has been drawn and has stopped changing
async function picture(page, locator) {
  let previous = null;
  for (let attempt = 0; attempt < 40; attempt++) {
    const current = await locator.screenshot();
    if (previous && current.equals(previous) && (await inkOf(page, current)) > 500) return current;
    previous = current;
    await page.waitForTimeout(100);
  }
  throw new Error("the cloud never settled into a drawn picture");
}

test("the element is defined and sized by its width and height attributes", async ({ page }) => {
  const cloud = await add(page, `${CLOUD} seed="323"`);
  const box = await cloud.boundingBox();
  expect(Math.round(box.width)).toBe(300);
  expect(Math.round(box.height)).toBe(200);
  expect(await cloud.evaluate((el) => el.shadowRoot.querySelectorAll("canvas").length)).toBe(1);
});

test("it draws a cloud", async ({ page }) => {
  const cloud = await add(page, `${CLOUD} seed="323"`);
  const png = await picture(page, cloud);
  expect(await inkOf(page, png)).toBeGreaterThan(500);
});

test("the same seed draws the same cloud, and a different seed a different one", async ({
  page,
}) => {
  const a = await add(page, `${CLOUD} seed="323"`, "a");
  const b = await add(page, `${CLOUD} seed="323"`, "b");
  const c = await add(page, `${CLOUD} seed="324"`, "c");
  const [pictureA, pictureB, pictureC] = [
    await picture(page, a),
    await picture(page, b),
    await picture(page, c),
  ];
  expect(pictureA.equals(pictureB)).toBe(true);
  expect(pictureA.equals(pictureC)).toBe(false);
});

test("currentSeed is the seed attribute, and changing the attribute rebuilds the cloud", async ({
  page,
}) => {
  const cloud = await add(page, `${CLOUD} seed="323"`);
  const before = await picture(page, cloud);
  expect(await cloud.evaluate((el) => el.currentSeed)).toBe(323);

  await cloud.evaluate((el) => el.setAttribute("seed", "7"));
  await expect.poll(() => cloud.evaluate((el) => el.currentSeed)).toBe(7);
  await expect.poll(async () => (await cloud.screenshot()).equals(before)).toBe(false);
});

test("seed 0 is a valid seed", async ({ page }) => {
  const cloud = await add(page, `${CLOUD} seed="0"`);
  await expect.poll(() => cloud.evaluate((el) => el.currentSeed)).toBe(0);
});

test("with no seed the cloud gets a random one, and keeps it when the element is rebuilt", async ({
  page,
}) => {
  const a = await add(page, CLOUD, "a");
  const b = await add(page, CLOUD, "b");
  await expect.poll(() => a.evaluate((el) => el.currentSeed)).toEqual(expect.any(Number));
  const seed = await a.evaluate((el) => el.currentSeed);
  expect(Number.isInteger(seed)).toBe(true);
  expect(await b.evaluate((el) => el.currentSeed)).not.toBe(seed);

  await a.evaluate((el) => el.setAttribute("width", "320")); // rebuilds
  await page.waitForTimeout(300);
  expect(await a.evaluate((el) => el.currentSeed)).toBe(seed);
});

test("regenerateOnClick: a click gives the cloud a new seed and fires seedchange", async ({
  page,
}) => {
  const cloud = await add(page, `${CLOUD} seed="323" regenerateOnClick`);
  const before = await picture(page, cloud);
  const seeds = cloud.evaluate(
    (el) =>
      new Promise((resolve) => el.addEventListener("seedchange", (e) => resolve(e.detail.seed))),
  );
  await cloud.click({ position: { x: 150, y: 150 } });

  const newSeed = await seeds;
  expect(newSeed).not.toBe(323);
  expect(await cloud.evaluate((el) => el.currentSeed)).toBe(newSeed);
  await expect
    .poll(async () => (await cloud.screenshot()).equals(before), { timeout: 10000 })
    .toBe(false);
});

test("without regenerateOnClick a click does nothing", async ({ page }) => {
  const cloud = await add(page, `${CLOUD} seed="323"`);
  await picture(page, cloud);
  await cloud.click({ position: { x: 150, y: 150 } });
  await page.waitForTimeout(500);
  expect(await cloud.evaluate((el) => el.currentSeed)).toBe(323);
});

test("the sunset fades the sky without rebuilding the cloud", async ({ page }) => {
  const cloud = await add(page, `${CLOUD} seed="323" sunsetDuration="300"`);
  const day = await picture(page, cloud);

  await cloud.evaluate((el) => el.setAttribute("sunset", ""));
  await expect
    .poll(async () => (await cloud.screenshot()).equals(day), { timeout: 10000 })
    .toBe(false);
  expect(await cloud.evaluate((el) => el.currentSeed)).toBe(323);

  await cloud.evaluate((el) => el.removeAttribute("sunset"));
  await expect
    .poll(async () => (await cloud.screenshot()).equals(day), { timeout: 10000 })
    .toBe(true);
});

test("setThemeValues restyles the cloud", async ({ page }) => {
  const cloud = await add(page, `${CLOUD} seed="323"`);
  const before = await picture(page, cloud);
  await cloud.evaluate((el) => el.setThemeValues({ colours: { dark: { light: 5 } } }));
  await expect
    .poll(async () => (await cloud.screenshot()).equals(before), { timeout: 10000 })
    .toBe(false);
});

test("a cloud removed from the page and put back is drawn again", async ({ page }) => {
  const cloud = await add(page, `${CLOUD} seed="323"`);
  const before = await picture(page, cloud);

  await cloud.evaluate((el) => {
    window.removed = el;
    el.remove();
  });
  await page.evaluate(() => document.body.append(window.removed));
  const after = await picture(page, cloud);
  expect(after.equals(before)).toBe(true);
});

test("a dimension with no attribute takes the element's CSS size", async ({ page }) => {
  const cloud = await add(page, 'seed="323" style="width: 260px; height: 140px; display: block"');
  await picture(page, cloud);
  const box = await cloud.boundingBox();
  expect([Math.round(box.width), Math.round(box.height)]).toEqual([260, 140]);
});

test.describe("with reduced motion", () => {
  test.use({ reducedMotion: "reduce" });

  test("growIn does nothing: the finished cloud is drawn at once", async ({ page }) => {
    const grown = await add(page, `${CLOUD} seed="323" growIn`, "grown");
    const still = await add(page, `${CLOUD} seed="323"`, "still");
    const pictureStill = await picture(page, still);
    expect((await picture(page, grown)).equals(pictureStill)).toBe(true);
  });
});
