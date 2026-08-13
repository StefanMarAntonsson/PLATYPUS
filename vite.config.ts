import tailwindcss from "@tailwindcss/vite";
import { sveltekit } from "@sveltejs/kit/vite";
import { defineConfig } from "vite-plus";

export default defineConfig({
  staged: {
    "*": "vp check --fix",
  },
  fmt: {},
  lint: { options: { typeAware: true, typeCheck: true } },
  plugins: [tailwindcss(), sveltekit()],
  server: {
    watch: {
      // These are generated outputs, not frontend inputs. Tauri compilation
      // can otherwise flood HMR and disconnect Vite's module-runner transport.
      ignored: ["**/src-tauri/target/**", "**/.svelte-kit/**", "**/build/**"],
    },
  },
});
