import { readFileSync } from "node:fs";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [{
    name: "distribute-project-license",
    apply: "build",
    generateBundle() {
      this.emitFile({
        type: "asset",
        fileName: "licenses/project.txt",
        source: readFileSync(new URL("./LICENSE", import.meta.url), "utf8"),
      });
    },
  }],
  server: {
    fs: {
      deny: [
        ".env", ".env.*", ".dev.vars*", "*.{crt,pem}", "**/.git/**",
        "**/.wrangler/**", "**/ref/**", "**/output/**", "**/*.unitypackage",
      ],
    },
  },
});
