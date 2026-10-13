import { createMcpToolHandlers, TOOL_DEFINITIONS } from "@/lib/mcp/tools";
import { queryClient } from "@/lib/db";
const ORG = "d3adb8d3-db1d-4fab-aac0-61c7f8644f13";
async function main() {
    const h = createMcpToolHandlers();
    const res = await h.list_email_logs({ pageSize: 100 }, { id: 0, orgId: ORG, scopes: [] } as never);
    const text = JSON.stringify(res);
    const parsed = JSON.parse((res as { content: { text: string }[] }).content[0].text);
    const logs = (parsed.data ?? parsed.logs ?? parsed) as { id: number; clickCount: number; botClickCount: number }[];
    const rows = (await queryClient`select send_log_id id, count(*) filter (where not is_bot)::int h, count(*) filter (where is_bot)::int b from email_click_logs where send_log_id = any(${logs.map((l) => l.id)}) group by 1`) as unknown as { id: number; h: number; b: number }[];
    const m = new Map(rows.map((r) => [r.id, r]));
    const bad = logs.filter((l) => l.clickCount !== (m.get(l.id)?.h ?? 0) || l.botClickCount !== (m.get(l.id)?.b ?? 0));
    const desc = TOOL_DEFINITIONS.find((t) => t.name === "list_email_logs")?.description ?? "";
    console.log(`rows ${logs.length}, 불일치 ${bad.length}, 봇 있는 행 ${logs.filter((l) => l.botClickCount > 0).length}, hasSiteAction 노출 ${text.includes("hasSiteAction")}, 설명에 봇 언급 ${desc.includes("봇")}`);
}
main().finally(() => queryClient.end());
