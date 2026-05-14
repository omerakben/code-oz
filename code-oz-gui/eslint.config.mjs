import { defineConfig } from "eslint/config";
import next from "eslint-config-next";

export default defineConfig([
  {
    ignores: [
      '.next/**',
      '.tmp/**',
      'node_modules/**',
      'playwright-report/**',
      'test-results/**',
    ],
  },
  {
    extends: [...next],
    rules: {
      'react-hooks/set-state-in-effect': 'off',
    },
  },
]);
