import { defineConfig } from "cypress";

export default defineConfig({
  e2e: {
    baseUrl: "https://localhost:4200",
    setupNodeEvents(on, config) {
      // implement node event listeners here
    },
  },
});
