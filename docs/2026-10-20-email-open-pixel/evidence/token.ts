// 사용: pnpm exec tsx --env-file=.env.local docs/2026-10-20-email-open-pixel/evidence/token.ts <orgId>  (로컬 시험 조직 전용 토큰)
import jwt from "jsonwebtoken";
const orgId = process.argv[2];
console.info(jwt.sign({ userId: "00000000-0000-4000-8000-0000000000f1", orgId, email: "fixture@example.invalid", name: "fixture", role: "owner" }, process.env.JWT_SECRET ?? "", { expiresIn: "1h" }));
