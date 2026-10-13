import { NextRequest } from "next/server";
import { z } from "zod";
import { copyAdminApi, CopyActionError } from "@/lib/ai-copy/api";
import { refreshEvaluationReport } from "@/lib/ai-copy/evaluations";
import { copyTransaction } from "@/lib/ai-copy/generation";
export const GET = (req: NextRequest, context: { params: Promise<{ id: string }> }) =>
    copyAdminApi(req, async (conn, user) => {
        const id = z.coerce
            .number()
            .int()
            .positive()
            .parse((await context.params).id);
        // 정책명·A/B·다른 평가자의 점수는 독립 평가가 끝나기 전 노출하지 않는다.
        const cases =
            await conn`SELECT c.id,c.blind_label,c.case_key,c.workspace_id,j.output,j.knowledge_snapshot,j.context->>'user' AS context_data,
        h.naturalness,h.factuality,h.purpose_fit,h.critical_error,h.notes,h.created_at AS reviewed_at,
        (SELECT count(*)::int FROM ai_copy_human_reviews v WHERE v.case_id=c.id) AS review_count,
        h.id IS NOT NULL AND (SELECT max(v.naturalness)-min(v.naturalness)>=2 OR max(v.factuality)-min(v.factuality)>=2 OR max(v.purpose_fit)-min(v.purpose_fit)>=2 OR bool_or(v.critical_error)<>bool_and(v.critical_error) FROM ai_copy_human_reviews v WHERE v.case_id=c.id) AS disagreement,
        EXISTS(SELECT 1 FROM ai_copy_review_resolutions v WHERE v.case_id=c.id) AS resolved,
        CASE WHEN h.id IS NOT NULL THEN COALESCE((SELECT jsonb_agg(jsonb_build_object('reviewerName',u.name,'naturalness',v.naturalness,'factuality',v.factuality,'purposeFit',v.purpose_fit,'criticalError',v.critical_error,'notes',v.notes) ORDER BY v.id)
            FROM ai_copy_human_reviews v LEFT JOIN users u ON u.id=v.reviewer_id WHERE v.case_id=c.id AND v.reviewer_id<>${user.userId}),'[]'::jsonb) ELSE '[]'::jsonb END AS other_reviews
        FROM ai_copy_evaluation_cases c JOIN ai_copy_evaluation_runs r ON r.id=c.run_id JOIN ai_copy_generation_jobs j ON j.id=c.job_id
        LEFT JOIN ai_copy_human_reviews h ON h.case_id=c.id AND h.reviewer_id=${user.userId}
        WHERE r.id=${id} AND r.org_id=${user.orgId} AND c.review_required AND j.state='ready'
        ORDER BY md5(c.blind_label || ${user.userId}) LIMIT 81`;
        // 80건 표본을 전부 무작위 순서로 받되 본문 생성 전에는 빈 평가로 표시한다.
        return { cases: cases.slice(0, 80), total: cases.length };
    });
const score = z.number().int().min(1).max(5);
const input = z.object({
    caseId: z.number().int().positive(),
    naturalness: score,
    factuality: score,
    purposeFit: score,
    criticalError: z.boolean(),
    notes: z.string().trim().max(2000),
    resolve: z.boolean().default(false),
});
export const POST = (req: NextRequest, context: { params: Promise<{ id: string }> }) =>
    copyAdminApi(req, async (conn, user) => {
        const id = z.coerce
                .number()
                .int()
                .positive()
                .parse((await context.params).id),
            body = input.parse(await req.json());
        await copyTransaction(conn, async () => {
            const [item] =
                await conn`SELECT c.id FROM ai_copy_evaluation_cases c JOIN ai_copy_evaluation_runs r ON r.id=c.run_id JOIN ai_copy_generation_jobs j ON j.id=c.job_id
            WHERE c.id=${body.caseId} AND c.run_id=${id} AND r.org_id=${user.orgId} AND c.review_required AND j.state='ready' AND r.state<>'cancelled' FOR UPDATE OF c`;
            if (!item) throw new CopyActionError("평가할 문구를 찾을 수 없습니다.");
            if (body.resolve) {
                const reviews =
                    await conn`SELECT reviewer_id FROM ai_copy_human_reviews WHERE case_id=${body.caseId}`;
                if (reviews.length < 2 || body.notes.length < 10)
                    throw new CopyActionError(
                        "두 사람의 평가와 10자 이상의 합의 근거가 필요합니다.",
                    );
                const [resolution] =
                    await conn`INSERT INTO ai_copy_review_resolutions(case_id,resolved_by,naturalness,factuality,purpose_fit,critical_error,reason)
                VALUES(${body.caseId},${user.userId},${body.naturalness},${body.factuality},${body.purposeFit},${body.criticalError},${body.notes}) ON CONFLICT DO NOTHING RETURNING case_id`;
                if (!resolution) throw new CopyActionError("이미 합의 결과가 저장된 문구입니다.");
            } else {
                const [reviewCount] = await conn<
                    { count: number }[]
                >`SELECT count(*)::int AS count FROM ai_copy_human_reviews WHERE case_id=${body.caseId}`;
                if (reviewCount.count >= 2)
                    throw new CopyActionError(
                        "두 사람의 평가가 이미 제출됐습니다. 합의가 필요한 문구인지 확인해 주세요.",
                    );
                const [review] =
                    await conn`INSERT INTO ai_copy_human_reviews(case_id,reviewer_id,naturalness,factuality,purpose_fit,critical_error,notes)
                VALUES(${body.caseId},${user.userId},${body.naturalness},${body.factuality},${body.purposeFit},${body.criticalError},${body.notes}) ON CONFLICT DO NOTHING RETURNING id`;
                if (!review)
                    throw new CopyActionError(
                        "이미 제출한 평가는 보존됩니다. 변경이 필요하면 새 평가를 만들어 주세요.",
                    );
            }
        });
        return refreshEvaluationReport(conn, user.orgId, id);
    });
