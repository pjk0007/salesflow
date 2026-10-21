// 사용: DATABASE_URL=<로컬 시험 DB> pnpm exec tsx --env-file=.env.local docs/2026-10-20-email-open-pixel/evidence/mcp-call.ts <orgId>
import { createMcpToolHandlers, TOOL_DEFINITIONS } from "../../../src/lib/mcp/tools";
import { queryClient } from "../../../src/lib/db";
import type { ApiTokenInfo } from "../../../src/lib/auth";

async function main() {
    const orgId = process.argv[2];
    const tokenInfo = { orgId, tokenId: 0, scopes: [] } as unknown as ApiTokenInfo;
    const res = await createMcpToolHandlers().list_email_logs({ pageSize: 20 }, tokenInfo);
    const text = res.content[0]?.type === "text" ? res.content[0].text : "";
    const data = JSON.parse(text) as { logs?: Array<Record<string, unknown>>; total?: number };
    console.info("description:", TOOL_DEFINITIONS.find(t => t.name === "list_email_logs")?.description);
    console.info("keys:", Object.keys(data));
    for (const log of data.logs ?? []) console.info(log.id, log.status, "open", log.openCount, "machine", log.machineOpenCount, "tracked", log.openTracked, "click", log.clickCount);
    await queryClient.end();
}
void main().catch(error => { console.error(error); process.exitCode = 1; });
