// 사용: pnpm exec tsx --env-file=.env.local docs/2026-10-20-email-open-pixel/evidence/sign-url.ts <baseUrl> <id...>
import { openPixelUrl } from "../../../src/lib/email-open-pixel";
const [baseUrl, ...ids] = process.argv.slice(2);
for (const id of ids) console.info(openPixelUrl(Number(id), { baseUrl }));
