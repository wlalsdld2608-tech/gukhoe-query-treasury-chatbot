import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const root = fileURLToPath(new URL(".", import.meta.url));

// Design Ref: §9.2 Vitest — 가상 질의 세트로 정확도·응답 시간을 잰다.
export default defineConfig({
  resolve: {
    alias: [
      // "@/..."는 프로젝트 루트를 가리킨다 (tsconfig의 경로 별칭과 같다).
      { find: /^@\//, replacement: `${root}` },
      // Next.js 밖에서 시험할 때 `import "server-only"`가 막히지 않게 빈 모듈로 바꾼다.
      { find: /^server-only$/, replacement: `${root}tests/stubs/server-only.ts` },
    ],
  },
  test: {
    include: ["tests/**/*.test.ts"],
  },
});
