import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  globalIgnores([
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // 시험·빌드가 만드는 전자서명 작업자 생성물(.gitignore 대상)
    ".esign-runtime/**",
  ]),
]);

export default eslintConfig;
