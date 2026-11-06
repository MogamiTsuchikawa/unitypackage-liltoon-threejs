import { defineConfig } from "vite";

export default defineConfig({
  server: {
    fs: {
      deny: [
        ".env", ".env.*", ".dev.vars*", "*.{crt,pem}", "**/.git/**",
        "**/.wrangler/**", "**/ref/**", "**/output/**", "**/*.unitypackage",
      ],
    },
  },
});
