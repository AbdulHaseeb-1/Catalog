import js from "@eslint/js";
import tseslint from "typescript-eslint";
import reactHooks from "eslint-plugin-react-hooks";
import reactRefresh from "eslint-plugin-react-refresh";
import prettierConfig from "eslint-config-prettier";
import globals from "globals";

export default tseslint.config(
  {
    ignores: [
      "**/dist/**",
      "**/build/**",
      "**/.output/**",
      "**/.wxt/**",
      "**/generated/**",
      "**/node_modules/**",
      "**/coverage/**",
      "**/*.d.ts",
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: {
      globals: {
        ...globals.node,
      },
    },
    rules: {
      "@typescript-eslint/no-unused-vars": [
        "warn",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
      "@typescript-eslint/no-explicit-any": "warn",
      "@typescript-eslint/consistent-type-imports": "warn",
      "no-console": ["warn", { allow: ["warn", "error", "info"] }],
    },
  },
  {
    files: [
      "apps/mobile/**/*.{ts,tsx}",
      "apps/demo-site/**/*.{ts,tsx}",
      "apps/extension/**/*.{ts,tsx}",
      "packages/ui/**/*.{ts,tsx}",
    ],
    languageOptions: {
      globals: {
        ...globals.browser,
      },
    },
    plugins: {
      "react-hooks": reactHooks,
      "react-refresh": reactRefresh,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      "react-refresh/only-export-components": ["warn", { allowConstantExport: true }],
    },
  },
  {
    files: ["apps/extension/**/*.{ts,tsx}"],
    languageOptions: {
      globals: {
        ...globals.webextensions,
      },
    },
  },
  {
    // React Native/Expo: has react-hooks like the other React apps, but no
    // DOM (globals.browser) and no Vite HMR (react-refresh).
    files: ["apps/native/**/*.{ts,tsx}"],
    languageOptions: {
      globals: {
        __DEV__: "readonly",
      },
    },
    plugins: {
      "react-hooks": reactHooks,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
    },
  },
  {
    // NestJS resolves constructor-injected providers via emitDecoratorMetadata
    // + reflect-metadata, which needs the *value* import of the class, not a
    // type-only one - `import type` erases it and DI silently fails at
    // runtime ("Nest can't resolve dependencies..."). This rule can't tell
    // "used as a DI type" apart from "only used as a type", so it's off here.
    files: ["apps/api/**/*.ts"],
    rules: {
      "@typescript-eslint/consistent-type-imports": "off",
    },
  },
  {
    files: ["**/*.spec.ts", "**/*.test.ts", "**/*.test.tsx", "**/test/**"],
    languageOptions: {
      globals: {
        ...globals.node,
      },
    },
    rules: {
      "@typescript-eslint/no-explicit-any": "off",
    },
  },
  prettierConfig,
);
