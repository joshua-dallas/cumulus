import { defineConfig } from "vite";
import tailwindcss from "@tailwindcss/vite";

// Builds the demo page for GitHub Pages (the library build is in vite.config.js)
export default defineConfig({
  root: "demo",
  // The site is served from https://joshua-dallas.github.io/cumulus/
  base: "/cumulus/",
  plugins: [tailwindcss()],
  build: {
    outDir: "../dist-demo",
    emptyOutDir: true,
  },
});
