module.exports = {
  env: {
    browser: true,
    es2022: true,
    node: true,
  },
  extends: ["eslint:recommended", "plugin:prettier/recommended"],
  parserOptions: {
    ecmaVersion: "latest",
    sourceType: "module",
  },
  ignorePatterns: ["node_modules/", "dist-app/", "dist/", "frontend/js/dist/"],
  overrides: [
    {
      files: ["src/**/*.js", "scripts/**/*.js"],
      env: { node: true, browser: false },
      parserOptions: {
        ecmaVersion: "latest",
        sourceType: "script",
      },
    },
    {
      files: ["tests/**/*.js"],
      env: { node: true, browser: false },
    },
  ],
  globals: {
    // Browser APIs available in Electron renderer + Node test env (via dom-mock)
    Blob: "readonly",
    URL: "readonly",
    URLSearchParams: "readonly",
    fetch: "readonly",
    TextDecoder: "readonly",
    AbortController: "readonly",
    Audio: "readonly",
    navigator: "readonly",
    document: "readonly",
    window: "readonly",
    localStorage: "readonly",
    requestAnimationFrame: "readonly",
    cancelAnimationFrame: "readonly",
    performance: "readonly",
    alert: "readonly",
    confirm: "readonly",
  },
  rules: {
    "no-unused-vars": ["warn", { args: "none" }],
    "no-undef": "error",
    "prefer-const": "warn",
    "no-var": "off",
    "prettier/prettier": "error",
  },
};
