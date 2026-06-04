import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { sql } from "drizzle-orm";
import { getUserFromNextRequest } from "@/lib/auth";

/**
 * 날짜별 발송·클릭을 "발송 유형 + 캠페인(템플릿/AI규칙) 이름" 단위로 드릴다운.
 * 같은 날 한 줄로 뭉치지 않고, 무슨 발송이 나갔는지 쪼개서 본다.
 *
 * Query: startDate, endDate (YYYY-MM-DD)
 * 응답: 날짜별 그룹 — 합계 + breakdown 행들(유형·캠페인·발송·클릭·클릭률)
 */
export async function GET(req: NextRequest) {
    const user = getUserFromNextRequest(req);
    if (!user) {
        return NextResponse.json({ success: false, error: "인증이 필요합니다." }, { status: 401 });
    }

    const sp = req.nextUrl.searchParams;
    const startDate = sp.get("startDate");
    const endDate = sp.get("endDate");
    if (!startDate || !endDate) {
        return NextResponse.json({ success: false, error: "startDate, endDate는 필수입니다." }, { status: 400 });
    }

    // 날짜 경계는 KST 기준 — 서버/DB가 Asia/Seoul이고 발송 시각도 KST라
    // UTC로 변환하면 새벽 발송분이 전날로 밀려 누락된다. +09:00을 명시해 KST 자정 경계로 비교.
    const fromIso = `${startDate}T00:00:00+09:00`;
    const toIso = `${endDate}T23:59:59.999+09:00`;

    try {
        const rows = (await db.execute(sql`
            -- 각 발송 로그의 캠페인/제품 식별.
            -- 후속발송은 자체 캠페인 FK가 없고 parent_log_id만 있어서, 부모를 타고
            -- 올라가 캠페인 이름이 잡히는 조상(root 원본 발송)에서 가져온다 (체인 깊이 무관).
            WITH RECURSIVE log_origin AS (
                -- base: 기간 내 발송 로그 + 자기 자신의 캠페인/제품
                SELECT
                    s.id,
                    s.id AS cur,
                    s.parent_log_id,
                    s.trigger_type,
                    s.sent_at,
                    COALESCE(tl.name, apl.name, et.name) AS campaign,
                    p.name AS product,
                    0 AS depth
                FROM email_send_logs s
                LEFT JOIN email_template_links tl ON tl.id = s.template_link_id
                LEFT JOIN email_auto_personalized_links apl ON apl.id = s.auto_personalized_link_id
                LEFT JOIN email_templates et ON et.id = s.email_template_id
                LEFT JOIN products p ON p.id = apl.product_id
                WHERE s.org_id = ${user.orgId}
                  AND s.sent_at >= ${fromIso}
                  AND s.sent_at <= ${toIso}

                UNION ALL

                -- recursive: 캠페인이 아직 안 잡혔으면 부모로 한 단계 올라간다
                SELECT
                    lo.id,
                    par.id AS cur,
                    par.parent_log_id,
                    lo.trigger_type,
                    lo.sent_at,
                    COALESCE(tl.name, apl.name, et.name) AS campaign,
                    p.name AS product,
                    lo.depth + 1
                FROM log_origin lo
                JOIN email_send_logs par ON par.id = lo.parent_log_id
                LEFT JOIN email_template_links tl ON tl.id = par.template_link_id
                LEFT JOIN email_auto_personalized_links apl ON apl.id = par.auto_personalized_link_id
                LEFT JOIN email_templates et ON et.id = par.email_template_id
                LEFT JOIN products p ON p.id = apl.product_id
                WHERE lo.campaign IS NULL AND lo.depth < 10
            ),
            resolved AS (
                -- 로그별로 캠페인이 잡힌 가장 얕은(가까운) 조상 1건 선택
                SELECT DISTINCT ON (id)
                    id, campaign, product, trigger_type, sent_at
                FROM log_origin
                WHERE campaign IS NOT NULL
                ORDER BY id, depth ASC
            ),
            -- 끝까지 캠페인을 못 찾은 로그는 별도로 살린다 (campaign NULL)
            final AS (
                SELECT lo.id, NULL::text AS campaign, NULL::text AS product, lo.trigger_type, lo.sent_at
                FROM log_origin lo
                WHERE lo.depth = 0
                  AND lo.id NOT IN (SELECT id FROM resolved)
                UNION ALL
                SELECT id, campaign, product, trigger_type, sent_at FROM resolved
            )
            SELECT
                (f.sent_at AT TIME ZONE 'Asia/Seoul')::date::text AS date,
                f.trigger_type AS "triggerType",
                COALESCE(f.product, '') AS product,
                COALESCE(f.campaign, '') AS campaign,
                count(*)::int AS sent,
                count(*) FILTER (WHERE EXISTS (
                    SELECT 1 FROM email_click_logs ecl WHERE ecl.send_log_id = f.id
                ))::int AS clicked
            FROM final f
            GROUP BY 1, 2, 3, 4
            ORDER BY 1 DESC, sent DESC
        `)) as unknown as Array<{
            date: string;
            triggerType: string | null;
            product: string;
            campaign: string;
            sent: number;
            clicked: number;
        }>;

        // 날짜별로 그룹핑 — 합계 + breakdown
        const byDate = new Map<string, {
            date: string;
            totalSent: number;
            totalClicked: number;
            breakdown: Array<{ triggerType: string; product: string; campaign: string; sent: number; clicked: number }>;
        }>();

        for (const r of rows) {
            let g = byDate.get(r.date);
            if (!g) {
                g = { date: r.date, totalSent: 0, totalClicked: 0, breakdown: [] };
                byDate.set(r.date, g);
            }
            g.totalSent += r.sent;
            g.totalClicked += r.clicked;
            g.breakdown.push({
                triggerType: r.triggerType ?? "unknown",
                product: r.product,
                campaign: r.campaign,
                sent: r.sent,
                clicked: r.clicked,
            });
        }

        return NextResponse.json({
            success: true,
            data: Array.from(byDate.values()),
        });
    } catch (error) {
        console.error("Email daily breakdown error:", error);
        return NextResponse.json({ success: false, error: "서버 오류가 발생했습니다." }, { status: 500 });
    }
}
