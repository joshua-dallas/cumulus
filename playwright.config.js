import { defineConfig, devices } from "@playwright/test";

const port = 4173;

export default defineConfig({
  testDir: "e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? "github" : "list",
  use: { baseURL: `http://localhost:${port}` },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  // The fixture page imports the library source, so the dev server is all that is needed
  webServer: {
    command: `npx vite --port ${port} --strictPort`,
    url: `http://localhost:${port}/e2e/fixture.html`,
    reuseExistingServer: !process.env.CI,
  },
});
