import { sql } from "drizzle-orm";
import type { CompareAxis } from "@/components/email/dashboard/types";
import { readRows } from "./read-shared";
import { stepLabel } from "../email-reply-rules";
const TRIGGERS: Record<string, string> = {
    manual: "수동 발송",
    auto: "자동 발송",
    repeat: "반복 발송",
    ai_auto: "AI 자동발송",
    followup: "후속 발송",
    ai_followup: "AI 후속발송",
    visit_ack: "방문 감사 메일"
};
interface NameRow {
    key: string;
    label: string;
    sublabel: string | null;
}

export async function comparisonNames(orgId: string, axis: CompareAxis, keys: string[]) {
    let rows: NameRow[] = [];
    if (axis === "campaign") {
        rows = await readRows<NameRow>(sql`SELECT 'ai:'||a.id AS key,COALESCE(a.name,'(이름 없음)') AS label,'AI 규칙' || COALESCE(' · '||p.name,'') AS sublabel
            FROM email_auto_personalized_links a LEFT JOIN products p ON p.id=a.product_id AND p.org_id=a.org_id
            WHERE a.org_id=${orgId}::uuid AND 'ai:'||a.id=ANY(${sql.param(keys)}::text[])
            UNION ALL SELECT 'template:'||t.id,t.name,'템플릿 연결' FROM email_template_links t JOIN partitions
            p ON p.id=t.partition_id JOIN workspaces w ON w.id=p.workspace_id
            WHERE w.org_id=${orgId}::uuid AND 'template:'||t.id=ANY(${sql.param(keys)}::text[])
            UNION ALL SELECT 'manual:'||id,name,'수동 발송' FROM email_templates WHERE org_id=${orgId}::uuid AND
            'manual:'||id=ANY(${sql.param(keys)}::text[])`);
    }
    else if (axis === "partition") {
        rows = await readRows<NameRow>(sql`SELECT p.id::text AS key,CASE WHEN (SELECT count(*) FROM workspaces WHERE org_id=${orgId}::uuid)>1 THEN '['||w.name||'] '
            ELSE '' END||p.name AS label,NULL::text AS sublabel
            FROM partitions p JOIN workspaces w ON w.id=p.workspace_id WHERE w.org_id=${orgId}::uuid AND p.id::text=ANY(${sql.param(keys)}::text[])`);
    }
    else if (axis === "sender") {
        rows = await readRows<NameRow>(sql`SELECT id::text AS key,from_email AS label,name AS sublabel FROM email_sender_profiles WHERE org_id=${orgId}::uuid
            AND id::text=ANY(${sql.param(keys)}::text[])`);
    }
    const names = new Map(rows.map((row) => [row.key, { label: row.label, sublabel: row.sublabel, deleted: false }]));
    for (const key of keys) {
        if (names.has(key))
            continue;
        let label: string | undefined;
        if (axis === "step")
            label = stepLabel(Number(key), null, null);
        if (axis === "trigger")
            label = TRIGGERS[key] ?? "기타";
        if (axis === "domain")
            label = key || "(주소 기록 없음 — 0073 이전)";
        if (axis === "date")
            label = `${key} (${new Intl.DateTimeFormat("ko-KR", { weekday: "short", timeZone: "Asia/Seoul" }).format(new Date(`${key}T00:00:00+09:00`))})`;
        if (axis === "campaign" && key === "manual:0")
            label = "수동 발송";
        if (axis === "partition" && key === "0")
            label = "명단 없음";
        if (axis === "sender" && key === "0")
            label = "기본 주소(프로필 없음)";
        names.set(key, { label: label ?? "(삭제됨)", sublabel: null, deleted: label === undefined });
    }
    return names;
}
