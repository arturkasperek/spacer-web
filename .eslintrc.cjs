module.exports = {
  root: true,
  ignorePatterns: ["dist/**", "node_modules/**"],
  overrides: [
    {
      files: ["src/**/*.{ts,tsx}"],
      parser: "@typescript-eslint/parser",
      parserOptions: {
        ecmaVersion: "latest",
        sourceType: "module",
        ecmaFeatures: {
          jsx: true,
        },
      },
      plugins: ["prettier"],
      extends: ["plugin:prettier/recommended"],
      rules: {
        "prettier/prettier": "error",
      },
    },
  ],
};
