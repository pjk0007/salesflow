/**
 * 미발송 레코드를 발송 큐에 적재한다.
 *
 * 2026-09-01 사고 대응으로 만들었지만, 같은 상황(유실·중단분 재적재)에 계속 쓸 수 있다.
 * 적재만 하고 발송은 워커가 한다 — 이 스크립트가 죽어도 큐는 남는다.
 *
 * 사용:
 *   tsx --env-file=.env.local scripts/enqueue-unsent.ts --partitions=56,55,34 --since=2026-09-01 --at="2026-09-02 12:00"
 *   (--apply 를 붙여야 실제로 적재된다. 기본은 dry-run)
 */
import { db, records, emailSendLogs, emailSendQueue, partitions, workspaces } from "@/lib/db";
import { and, eq, gte, inArray, sql, notExists } from "drizzle-orm";
import { enqueueSends } from "@/lib/email-send-queue";

interface Args {
    partitionIds: number[];
    since: Date;
    scheduledAt?: Date;
    apply: boolean;
}

function parseArgs(): Args {
    const get = (name: string): string | undefined =>
        process.argv.find((a) => a.startsWith(`--${name}=`))?.split("=").slice(1).join("=");

    const partitionsRaw = get("partitions");
    if (!partitionsRaw) throw new Error("--partitions=56,55 형식으로 지정할 것");
    const partitionIds = partitionsRaw.split(",").map((s) => {
        const n = Number(s.trim());
        if (!Number.isInteger(n) || n <= 0) throw new Error(`잘못된 파티션 id: ${s}`);
        return n;
    });

    const sinceRaw = get("since");
    if (!sinceRaw) throw new Error("--since=2026-09-01 형식으로 지정할 것");
    // KST 자정 기준
    const since = new Date(`${sinceRaw}T00:00:00+09:00`);
    if (Number.isNaN(since.getTime())) throw new Error(`잘못된 날짜: ${sinceRaw}`);

    const atRaw = get("at");
    let scheduledAt: Date | undefined;
    if (atRaw) {
        // "2026-09-02 12:00" 또는 "2026-09-02T12:00" (KST)
        const m = atRaw.trim().match(/^(\d{4}-\d{2}-\d{2})[ T](\d{2}):(\d{2})$/);
        if (!m) throw new Error(`--at 형식은 "YYYY-MM-DD HH:mm" 이어야 한다: ${atRaw}`);
        scheduledAt = new Date(`${m[1]}T${m[2]}:${m[3]}:00+09:00`);
        if (Number.isNaN(scheduledAt.getTime())) throw new Error(`잘못된 예약 시각: ${atRaw}`);
    }

    return { partitionIds, since, scheduledAt, apply: process.argv.includes("--apply") };
}

async function main() {
    const { partitionIds, since, scheduledAt, apply } = parseArgs();

    console.log("대상 파티션:", partitionIds.join(", "));
    console.log("업로드 기준일:", since.toISOString());
    console.log("발송 예약:", scheduledAt ? scheduledAt.toISOString() : "즉시");
    console.log("모드:", apply ? "APPLY (실제 적재)" : "DRY-RUN");

    // 파티션별 orgId 확보 — 레코드의 org_id를 믿지 않고 파티션 소속으로 정한다
    const partitionRows = await db
        .select({ id: partitions.id, orgId: workspaces.orgId, name: partitions.name })
        .from(partitions)
        .innerJoin(workspaces, eq(partitions.workspaceId, workspaces.id))
        .where(inArray(partitions.id, partitionIds));

    if (partitionRows.length !== partitionIds.length) {
        const found = new Set(partitionRows.map((p) => p.id));
        throw new Error(`존재하지 않는 파티션: ${partitionIds.filter((id) => !found.has(id)).join(", ")}`);
    }

    let grandTotal = 0;

    for (const p of partitionRows) {
        // 발송 로그가 없고, 이미 큐에 있지도 않은 레코드
        const targets = await db
            .select({ id: records.id })
            .from(records)
            .where(
                and(
                    eq(records.partitionId, p.id),
                    gte(records.createdAt, since),
                    sql`${records.data}->>'email' LIKE '%@%'`,
                    notExists(
                        db.select({ x: sql`1` }).from(emailSendLogs).where(eq(emailSendLogs.recordId, records.id)),
                    ),
                    notExists(
                        db.select({ x: sql`1` }).from(emailSendQueue).where(eq(emailSendQueue.recordId, records.id)),
                    ),
                ),
            )
            .orderBy(records.id);

        console.log(`\n파티션 ${p.id} (${p.name}): 적재 대상 ${targets.length}건`);
        if (targets.length > 0) {
            console.log(`  record_id 범위: ${targets[0].id} ~ ${targets[targets.length - 1].id}`);
        }
        grandTotal += targets.length;

        if (apply && targets.length > 0) {
            // 큰 배열을 한 번에 INSERT하면 파라미터 한도에 걸린다
            const CHUNK = 500;
            let inserted = 0;
            for (let i = 0; i < targets.length; i += CHUNK) {
                inserted += await enqueueSends({
                    recordIds: targets.slice(i, i + CHUNK).map((t) => t.id),
                    partitionId: p.id,
                    orgId: p.orgId,
                    triggerType: "on_create",
                    scheduledAt,
                });
            }
            console.log(`  적재 완료: ${inserted}건`);
        }
    }

    console.log(`\n총 ${grandTotal}건`);
    if (!apply) console.log("실제로 적재하려면 --apply 를 붙일 것");
    process.exit(0);
}

main().catch((e) => {
    console.error("실패:", e instanceof Error ? e.message : e);
    process.exit(1);
});
