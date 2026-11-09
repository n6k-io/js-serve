import js from "@eslint/js";
import tseslint from "typescript-eslint";
import unicorn from "eslint-plugin-unicorn";

/** @type {import('eslint').Linter.Config[]} */
export default [
  js.configs.recommended,
  ...tseslint.configs.recommended,
  unicorn.configs.recommended,
  {
    rules: {
      "max-lines": [
        "error",
        { max: 300, skipBlankLines: true, skipComments: true },
      ],
      complexity: ["error", { max: 20 }],
      "@typescript-eslint/no-unused-vars": "error",
      "@typescript-eslint/consistent-type-assertions": [
        "error",
        { assertionStyle: "never" },
      ],
      "unicorn/filename-case": [
        "error",
        {
          cases: {
            kebabCase: true,
            pascalCase: true,
            camelCase: true,
          },
          ignore: [/DB/i],
        },
      ],
      "unicorn/text-encoding-identifier-case": "off",
      "unicorn/prevent-abbreviations": "off",
      "unicorn/no-null": "off",
      "unicorn/catch-error-name": "off",
      "unicorn/prefer-global-this": "off",
      "unicorn/no-nested-ternary": "off",
      // `this` is the legitimate context in Vite/rollup plugin hooks — this rule
      // (new in unicorn 65) flags those as false positives.
      "unicorn/no-this-outside-of-class": "off",
      // DuckDB `conn.query()` returns an Apache Arrow `Table`, whose `.toArray()`
      // yields a plain array. This rule (new in unicorn 65) assumes the receiver
      // is a JS iterator helper and rewrites `t.toArray().map(fn)` →
      // `t.map(fn).toArray()`, but Arrow `Table` has no `.map` — the rewrite
      // would crash. False positive for our query code; disable it.
      "unicorn/prefer-iterator-to-array-at-end": "off",
    },
  },
  {
    files: ["**/*.test.ts", "**/*.test.tsx"],
    rules: {
      // Tests often need structural stubs / narrowing casts; assertions are
      // acceptable here.
      "@typescript-eslint/consistent-type-assertions": "off",
    },
  },
  {
    // Copied from template: the @n6k.io/ui component set is cast to MDXComponents.
    files: ["src/mdx-components.tsx"],
    rules: { "@typescript-eslint/consistent-type-assertions": "off" },
  },
  {
    ignores: ["node_modules/", "dist/"],
  },
];
