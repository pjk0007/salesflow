/**
 * 웹훅 연결 확인 (구글 챗 QA WPN-11) — 관리자가 발송 건강 화면에서 누른다. DB.
 *
 * 웹훅 설정 검사는 "https로 시작하는가"뿐이라 dry_run 동안이나 live로 올리기 전에는 고장 난 웹훅을 알 수 없었다.
 * 이 조직이 쓰는 받는 곳마다 "연결 확인" 한 통을 보내고 결과를 한국어로 돌려준다 (주소·key·token은 돌려주지 않는다).
 * 결과는 전달 상태 표에도 남는다 — 고장이면 운영 스페이스 알림·화면에 그대로 이어진다.
 * 같은 조직은 10분에 한 번만 (누를 때마다 스페이스에 글이 쌓이지 않게). 운영 받는 곳은 발신 건강 대상 조직(우리 조직)만 확인한다.
 */
import { sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { postGoogleChatText, type GoogleChatResult } from "@/lib/google-chat";
import { recordChatWebhookConfig, recordChatWebhookResult } from "@/lib/chat-webhook-status";
import { formatKstShort } from "@/lib/kst";
import { chatSafe } from "@/lib/chat-text";
import { resolveSendHealthConfig } from "@/lib/sender-health-rules";
import { resolveSendHealthOrgScope } from "@/lib/sender-health";

type Env = Record<string, string | undefined>;

const CHECK_INTERVAL_MS = 10 * 60 * 1000;
const lastCheckByOrg = new Map<string, number>();

export interface WebhookCheckResult {
    source: string;
    label: string;
    ok: boolean;
    /** 한국어 한 줄 (주소 없음) */
    message: string;
}

function idList(v: string | undefined): number[] {
    return (v ?? "")
        .split(",")
        .map((x) => x.trim())
        .filter((x) => /^\d+$/.test(x))
        .map(Number);
}

/** 이 조직이 쓰는 받는 곳 (환경 변수 이름 → 값). 주소는 밖으로 내보내지 않는다 */
async function targetsFor(orgId: string, env: Env): Promise<Array<{ source: string; workspaceId: number | null; label: string; url: string }>> {
    const ws = (await db.execute(sql`SELECT id, name FROM workspaces WHERE org_id = ${orgId}::uuid ORDER BY id`)) as unknown as Array<{ id: number; name: string }>;
    const allowed = new Set([...idList(env.DEEP_ALERT_WORKSPACE_IDS), ...idList(env.REPLY_WORKSPACE_IDS)]);
    const out: Array<{ source: string; workspaceId: number | null; label: string; url: string }> = [];
    for (const w of ws) {
        const id = Number(w.id);
        const label = `사업 스페이스 「${chatSafe(w.name, { max: 40 })}」`;
        for (const source of [`DEEP_ALERT_WEBHOOK_URL_${id}`, `SEND_HEALTH_WEBHOOK_URL_${id}`]) {
            const url = (env[source] ?? "").trim();
            // 허용 목록에 있는데 비어 있는 깊이·회신 웹훅도 "없음"으로 알린다
            if (url || (source.startsWith("DEEP_ALERT") && allowed.has(id))) out.push({ source, workspaceId: id, label, url });
        }
    }
    const scope = await resolveSendHealthOrgScope(resolveSendHealthConfig(env));
    if (scope === "all" || scope.includes(orgId)) {
        for (const source of ["SEND_HEALTH_WEBHOOK_URL", "REPLY_OPS_WEBHOOK_URL"]) {
            const url = (env[source] ?? "").trim();
            if (url || source === "SEND_HEALTH_WEBHOOK_URL") out.push({ source, workspaceId: null, label: "운영 스페이스", url });
        }
    }
    return out;
}

export async function checkChatWebhooks(input: {
    orgId: string;
    actorName: string | null;
    env?: Env;
    now?: Date;
    post?: (url: string, text: string) => Promise<GoogleChatResult>;
}): Promise<{ ok: true; results: WebhookCheckResult[] } | { ok: false; status: 429; error: string }> {
    const env = input.env ?? process.env;
    const now = input.now ?? new Date();
    const last = lastCheckByOrg.get(input.orgId);
    if (last && now.getTime() - last < CHECK_INTERVAL_MS) {
        const mins = Math.ceil((CHECK_INTERVAL_MS - (now.getTime() - last)) / 60000);
        return { ok: false, status: 429, error: `연결 확인은 10분에 한 번 할 수 있습니다 (${mins}분 뒤 다시)` };
    }
    lastCheckByOrg.set(input.orgId, now.getTime());
    const post = input.post ?? ((url: string, text: string) => postGoogleChatText(url, text));
    const who = input.actorName ? `${chatSafe(input.actorName, { max: 30 })}님` : "관리자";
    const text = `✅ 샌드비 알림 연결 확인 — 이 스페이스로 샌드비 알림이 옵니다 (${who}, ${formatKstShort(now)}). 답하지 않아도 됩니다.`;
    const results: WebhookCheckResult[] = [];
    for (const t of await targetsFor(input.orgId, env)) {
        if (!t.url) {
            await recordChatWebhookConfig(t.source, t.workspaceId, t.url);
            results.push({ source: t.source, label: t.label, ok: false, message: `웹훅 주소가 비어 있습니다 (환경 변수 ${t.source})` });
            continue;
        }
        const r = await post(t.url, text);
        await recordChatWebhookResult(t.source, t.workspaceId, r, t.url);
        results.push({
            source: t.source,
            label: t.label,
            ok: r.ok,
            message: r.ok ? "연결 확인 글을 보냈습니다" : r.error.slice(0, 200),
        });
    }
    return { ok: true, results };
}
