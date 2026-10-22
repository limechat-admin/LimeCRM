import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = [
  ...nextVitals,
  ...nextTs,
  // .claude/worktrees holds parallel sessions' checkouts; they lint themselves.
  { ignores: ["node_modules/**", ".next/**", "out/**", "build/**", "next-env.d.ts", "drizzle/**", ".claude/**", "data/**"] },
];

export default eslintConfig;
