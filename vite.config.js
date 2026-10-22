import { defineConfig } from "vite";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  // Relative asset URLs: the worker is found relative to the built file, wherever dist/ is served
  base: "./",
  plugins: [tailwindcss()],
  build: {
    lib: {
      entry: { cumulus: "src/index.js", define: "src/define.js" },
      formats: ["es"],
    },
  },
});
