/**
 * 미발송 레코드 재처리 — on_create 트리거를 놓친 레코드를 발송 파이프라인에 다시 태운다.
 *
 * 발송 로직은 실제 자동발송과 동일한 processAutoPersonalizedEmail을 그대로 쓴다.
 * (중복 방지·쿨다운·수신거부·쿼터 체크가 전부 그 안에서 동작한다)
 * 발송 대기열이 맡고 있는 레코드(pending·processing — 발신 한도로 미뤄 둔 줄 포함)는 대상에서 뺀다.
 * 놓친 레코드를 한꺼번에 다시 태우는 대량 경로라 발송 목적은 "bulk"다 — 15:00(KST) 전까지 주소마다 문의 몫(한도의 10%)을
 * 남긴다 (DESIGN-2 2절). 배치 안 자리 잡기는 대기열 워커처럼 순서대로 하나씩 한다 (createClaimTurns).
 *
 * 사용:
 *   DATABASE_URL=... npx tsx scripts/resend-unsent.ts --partition 55 --limit 10 --dry-run
 *   DATABASE_URL=... npx tsx scripts/resend-unsent.ts --partition 55 --limit 10
 *   DATABASE_URL=... npx tsx scripts/resend-unsent.ts --partition 55            # 전량
 *
 * 옵션:
 *   --partition <id>  대상 파티션 (필수)
 *   --limit <n>       처리할 최대 건수 (미지정 시 전량)
 *   --dry-run         대상만 출력하고 발송하지 않음
 *   --batch <n>       동시 처리 건수 (기본 3)
 *   --delay <ms>      배치 간 대기 (기본 2000)
 */
import * as dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

import { db, records, partitions, workspaces, emailSendLogs, emailSendQueue, emailAutoPersonalizedLinks, products } from "../src/lib/db";
import { and, eq, sql } from "drizzle-orm";
import { processAutoPersonalizedEmail } from "../src/lib/auto-personalized-email";
import { foldOutcome, deferredUntil } from "../src/lib/auto-personalized-email-outcome";
import { createClaimTurns } from "../src/lib/email-send-queue-rules";
import { getAiClient, getSearchAiClient, generateCompanyResearch, generateEmail } from "../src/lib/ai";
import { getEmailConfig } from "../src/lib/nhn-email";
import { resolveSender, resolveSignature } from "../src/lib/email-sender-resolver";
import { linkSenderPool } from "../src/lib/email-sender-limit-rules";
import { formatKstShort } from "../src/lib/kst";
import { substitutePromptVariables } from "../src/lib/email-utils";
import type { DbRecord } from "../src/lib/db";

function arg(name: string): string | undefined {
    const i = process.argv.indexOf(`--${name}`);
    return i >= 0 ? process.argv[i + 1] : undefined;
}
const hasFlag = (name: string) => process.argv.includes(`--${name}`);

const partitionId = Number(arg("partition"));
const limit = arg("limit") ? Number(arg("limit")) : undefined;
const batchSize = Number(arg("batch") ?? 3);
const delayMs = Number(arg("delay") ?? 2000);
const dryRun = hasFlag("dry-run");

function stripHtml(html: string): string {
    return html
        .replace(/<br\s*\/?>/gi, "\n")
        .replace(/<\/p>/gi, "\n")
        .replace(/<[^>]*>/g, "")
        .replace(/&nbsp;/g, " ")
        .trim();
}

// 발송 직전까지의 과정(리서치 → 프롬프트 조립 → 메일 생성)을 실제와 동일하게 돌리고
// NHN 발송만 건너뛴다. 발송 로그도 남기지 않는다.
async function previewOnly(targets: typeof records.$inferSelect[], orgId: string) {
    const [link] = await db
        .select()
        .from(emailAutoPersonalizedLinks)
        .where(and(
            eq(emailAutoPersonalizedLinks.partitionId, partitionId),
            eq(emailAutoPersonalizedLinks.triggerType, "on_create"),
            eq(emailAutoPersonalizedLinks.isActive, 1),
        ))
        .limit(1);

    const aiClient = getAiClient(link.model || undefined);
    const searchClient = getSearchAiClient();
    if (!aiClient) throw new Error("ANTHROPIC_API_KEY 미설정 — AI 클라이언트를 만들 수 없습니다.");

    const emailConfig = await getEmailConfig(orgId);
    const signatureJson = await resolveSignature(orgId, { requestedId: link.signatureId ?? undefined, config: emailConfig });
    // 묶음이면 첫 주소를 보인다 (실제 발송은 그중 오늘 보낼 수 있는 가장 오래 쉰 주소)
    const sender = await resolveSender(orgId, { preferredIds: linkSenderPool(link), config: emailConfig });

    let product = null;
    if (link.productId) {
        const [p] = await db.select().from(products).where(eq(products.id, link.productId)).limit(1);
        product = p ?? null;
    }

    let senderPersona: { name: string; title?: string; company?: string } | null = null;
    if (link.useSignaturePersona === 1 && signatureJson) {
        try {
            const sig = JSON.parse(signatureJson);
            if (sig?.name) senderPersona = { name: sig.name, title: sig.title || undefined, company: sig.company || undefined };
        } catch { /* legacy plain text signature */ }
    }

    console.log(`\n발신: ${sender.fromName} <${sender.fromEmail}>`);
    console.log(`AI  : ${aiClient.provider} / ${aiClient.model}  |  리서치: ${searchClient?.model ?? "(없음)"}`);
    console.log(`페르소나: ${senderPersona ? `${senderPersona.name} ${senderPersona.title ?? ""} (${senderPersona.company ?? ""})` : "미사용"}`);
    console.log("\n" + "=".repeat(72));

    let totalIn = 0, totalOut = 0;

    for (const record of targets) {
        const data = record.data as Record<string, unknown>;
        const companyName = data[link.companyField] as string;
        const recipient = data[link.recipientField] as string;

        console.log(`\n[#${record.id}] ${companyName ?? "(회사명 없음)"}  →  ${recipient ?? "(이메일 없음)"}`);
        console.log(`  담당자: ${data.name ?? "(없음)"} | 연락처: ${data.contact ?? "(없음)"}`);

        if (!recipient || !recipient.includes("@")) {
            console.log("  ⚠ 이메일 없음 — 실제 발송 시 건너뜀");
            continue;
        }

        const recordData: Record<string, unknown> = { ...data };
        if (link.autoResearch === 1 && !recordData._companyResearch && searchClient && companyName?.trim()) {
            const research = await generateCompanyResearch(searchClient, { companyName, additionalContext: data });
            recordData._companyResearch = { ...research, researchedAt: new Date().toISOString() };
            totalIn += research.usage.promptTokens; totalOut += research.usage.completionTokens;

            const found = research.industry !== "정보 없음" || research.sources.length > 0;
            console.log(`  리서치: ${found ? "✓" : "△ 정보 부족"} | 업종=${research.industry} | 출처 ${research.sources.length}건 | ${research.usage.promptTokens}/${research.usage.completionTokens} 토큰`);
            if (found) console.log(`          ${String(research.description).slice(0, 90)}...`);
        }

        const prompt = substitutePromptVariables(link.prompt || "", recordData);
        const mail = await generateEmail(aiClient, {
            prompt, product, recordData,
            tone: link.tone || undefined,
            ctaUrl: link.ctaUrl || product?.url || undefined,
            format: (link.format as "plain" | "designed") || "plain",
            senderPersona,
        });
        totalIn += mail.usage.promptTokens; totalOut += mail.usage.completionTokens;

        console.log(`\n  [제목] ${mail.subject}`);
        console.log("  [본문]");
        for (const line of stripHtml(mail.htmlBody).split("\n")) {
            if (line.trim()) console.log(`    ${line}`);
        }
        console.log(`  [체크] 제목에 회사명=${mail.subject.includes(companyName ?? "")} | 제목에 이름=${mail.subject.includes(String(data.name ?? ""))} | cite태그=${/cite\s+index=|<\/cite>/.test(mail.subject + mail.htmlBody)}`);
        console.log(`  [토큰] ${mail.usage.promptTokens}/${mail.usage.completionTokens}`);
        console.log("-".repeat(72));
    }

    const cost = (totalIn / 1_000_000) * 1 + (totalOut / 1_000_000) * 5;
    console.log(`\n합계 토큰: 입력 ${totalIn.toLocaleString()} / 출력 ${totalOut.toLocaleString()}`);
    console.log(`이 ${targets.length}건 예상 비용: $${cost.toFixed(3)} (Haiku 4.5 기준)`);
    console.log(`건당 평균: 입력 ${Math.round(totalIn / targets.length).toLocaleString()} / 출력 ${Math.round(totalOut / targets.length).toLocaleString()}`);
    console.log("\n※ DRY RUN — 메일은 발송되지 않았고 발송 로그도 남지 않았습니다.");
}

async function main() {
    if (!partitionId) {
        console.error("--partition <id> 는 필수입니다.");
        process.exit(1);
    }

    const [partition] = await db
        .select({ id: partitions.id, name: partitions.name, orgId: workspaces.orgId })
        .from(partitions)
        .innerJoin(workspaces, eq(workspaces.id, partitions.workspaceId))
        .where(eq(partitions.id, partitionId));

    if (!partition) {
        console.error(`파티션 ${partitionId} 를 찾을 수 없습니다.`);
        process.exit(1);
    }

    const rules = await db
        .select({ id: emailAutoPersonalizedLinks.id, name: emailAutoPersonalizedLinks.name, model: emailAutoPersonalizedLinks.model })
        .from(emailAutoPersonalizedLinks)
        .where(and(
            eq(emailAutoPersonalizedLinks.partitionId, partitionId),
            eq(emailAutoPersonalizedLinks.triggerType, "on_create"),
            eq(emailAutoPersonalizedLinks.isActive, 1),
        ));

    if (rules.length === 0) {
        console.error(`파티션 ${partitionId} 에 활성 AI 발송 규칙이 없습니다.`);
        process.exit(1);
    }

    console.log(`파티션: ${partition.name} (${partitionId})`);
    console.log(`규칙  : ${rules.map((r) => `${r.name}[${r.model ?? "기본"}]`).join(", ")}`);

    // 발송 로그가 없는 레코드 = 미발송. 단 발송 대기열이 맡고 있는 레코드(pending·processing)는 뺀다 —
    // 발신 한도로 미뤄 둔 줄은 로그가 없어도 대기열이 retryAt에 보낸다. 여기서 또 보내면 같은 사람에게 두 번 나간다
    // (쿨다운은 1시간만 보고 중복 수신자 막기는 기본이 꺼져 있다). 트리거 종류를 가리지 않는다 — on_update 줄도 같은 메일을 보낸다
    const targets = await db
        .select()
        .from(records)
        .where(and(
            eq(records.partitionId, partitionId),
            sql`not exists (select 1 from ${emailSendLogs} where ${emailSendLogs.recordId} = ${records.id})`,
            sql`not exists (select 1 from ${emailSendQueue} where ${emailSendQueue.recordId} = ${records.id} and ${emailSendQueue.status} in ('pending', 'processing'))`,
        ))
        .orderBy(records.id)
        .limit(limit ?? 1_000_000);

    console.log(`미발송 대상: ${targets.length}건${limit ? ` (limit ${limit})` : " (전량)"}`);

    if (targets.length === 0) {
        console.log("처리할 레코드가 없습니다.");
        process.exit(0);
    }

    if (dryRun) {
        // 리서치·메일 생성까지 실제로 돌리고 발송만 건너뛴다 (AI 토큰은 소모됨)
        await previewOnly(targets, partition.orgId);
        process.exit(0);
    }

    // 미룸은 성공이 아니다 — 발신 한도·시간대에 막혀 보내지 않았고 로그도 없어 다음 실행에서 다시 대상이 된다
    let done = 0, failed = 0, deferred = 0;
    let earliestRetry: Date | null = null;
    const startedAt = Date.now();

    for (let i = 0; i < targets.length; i += batchSize) {
        const batch = targets.slice(i, i + batchSize);
        // 자리 잡기는 순서대로 하나씩 — 함께 잡으면 같은 사용량을 읽어 묶음의 한 주소에 몰린다
        const turns = createClaimTurns(batch.length);
        const results = await Promise.allSettled(
            batch.map((record, idx) =>
                processAutoPersonalizedEmail({
                    record: record as DbRecord,
                    partitionId,
                    triggerType: "on_create",
                    orgId: partition.orgId,
                    // 대량 재처리다 — 오전에 돌려도 그날 들어올 문의 몫을 먼저 쓰지 않게
                    purpose: "bulk",
                    claimTurn: turns[idx],
                }).finally(() => turns[idx].done())
            )
        );

        for (const [idx, res] of results.entries()) {
            if (res.status === "rejected") {
                failed++;
                console.error(`  #${batch[idx].id} 실패:`, res.reason instanceof Error ? res.reason.message : res.reason);
            } else {
                // 실패가 섞여 있어도 미룬 규칙은 보내지 않았다 — 성공으로 세지 않는다
                const d = deferredUntil(res.value);
                if (d) {
                    deferred++;
                    console.log(
                        `  #${batch[idx].id} 미룸 (${d.reason}) → ${formatKstShort(d.retryAt)} KST` +
                        (foldOutcome(res.value) === "error" ? " (다른 규칙 실패 포함)" : "")
                    );
                    if (!earliestRetry || d.retryAt < earliestRetry) earliestRetry = d.retryAt;
                } else {
                    done++;
                }
            }
        }

        const elapsed = Math.round((Date.now() - startedAt) / 1000);
        console.log(
            `진행 ${i + batch.length}/${targets.length} (성공 ${done} 미룸 ${deferred} 실패 ${failed}, ${elapsed}초 경과)`
        );

        if (i + batchSize < targets.length) {
            await new Promise((r) => setTimeout(r, delayMs));
        }
    }

    console.log(
        `\n완료: 처리 ${done}건, 미룸 ${deferred}건, 실패 ${failed}건, ${Math.round((Date.now() - startedAt) / 1000)}초`
    );
    if (deferred > 0) {
        // 이 스크립트는 대기열을 거치지 않아 미룬 건을 다시 시도할 곳이 없다 — 대기열에 넣어 워커가 열리는 시각에 보내게 한다.
        // 이 스크립트를 다시 돌리라고 하지 않는다: 열리는 시각을 사람이 맞춰야 하고, 그사이 대기열에 들어간 레코드와 겹칠 수 있다
        console.log(
            `미룬 ${deferred}건은 발신 한도·시간대에 막혀 보내지 않았습니다 (가장 이른 재시도 ` +
            `${earliestRetry ? `${formatKstShort(earliestRetry)} KST` : "알 수 없음"}). ` +
            `scripts/enqueue-unsent.ts --partitions=${partitionId} --since=<업로드한 날> --apply 로 발송 대기열에 넣으세요 ` +
            `(대기열이 한도가 열리는 시각에 이어서 보냅니다).`
        );
    }
    process.exit(0);
}

main().catch((err) => {
    console.error("FAILED:", err instanceof Error ? err.message : err);
    process.exit(1);
});
