// 임시 DB(salesflow_botcheck)에서 recordClick·hasClicked·clickSignalsForSendLogs를 실제로 돌려 B8~B11·B15·B25를 확인한다
import { sql } from "/Users/jaehun/Projects/salesflow/node_modules/drizzle-orm/index.js";
import { db, queryClient } from "@/lib/db";
import { recordClick, hasClicked } from "@/lib/email-click-tracking";
import { clickSignalsForSendLogs } from "@/lib/email-click-signals";

const ORG = "00000000-0000-0000-0000-00000000b0b0";
const OTHER = "00000000-0000-0000-0000-00000000c0c0";
const CH = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36";
const results: string[] = [];
const check = (name: string, ok: boolean, detail: unknown) => results.push(`${ok ? "PASS" : "FAIL"} ${name} ${JSON.stringify(detail)}`);

async function sendLog(tag: string, agoSec: number): Promise<number> {
    const rows = (await db.execute(sql`INSERT INTO email_send_logs(org_id, recipient_email, status, sent_at, subject)
        VALUES (${ORG}::uuid, ${tag + "@fixture.invalid"}, 'sent', now() - ${agoSec} * interval '1 second', ${tag}) RETURNING id`)) as unknown as { id: number }[];
    return rows[0].id;
}
async function rows(id: number) {
    return (await db.execute(sql`SELECT id, is_bot AS "isBot", bot_reason AS "reason", click_id AS "clickId" FROM email_click_logs WHERE send_log_id = ${id} ORDER BY id`)) as unknown as { id: number; isBot: boolean; reason: string | null; clickId: string }[];
}

async function main() {
    // B8: curl UA → ua, clickId는 발급
    const a = await sendLog("B8", 3600);
    const r8 = await recordClick(a, "https://x.invalid", "1.2.3.4", "curl/8.4.0");
    const a8 = await rows(a);
    check("B8 curl→ua, clickId 발급", !!r8?.clickId && a8[0].isBot && a8[0].reason === "ua", { r8, a8 });
    check("B15 봇만 있는 발송 hasClicked=false", (await hasClicked(a)) === false, null);

    // early: 방금 발송
    const e = await sendLog("early", 0);
    await recordClick(e, "https://x.invalid", undefined, CH);
    const e1 = await rows(e);
    check("B4 실경로 early", e1[0].reason === "early", e1);

    // 사람 1건 → hasClicked true
    const h = await sendLog("human", 3600);
    await recordClick(h, "https://x.invalid", undefined, CH);
    const h1 = await rows(h);
    check("사람 클릭 is_bot=false", h1[0].isBot === false && h1[0].reason === null, h1);
    await recordClick(h, "https://x.invalid", undefined, "curl/8.4.0"); // 섞인 발송
    check("B15 섞인 발송 hasClicked=true", (await hasClicked(h)) === true, null);

    // B9: 사람 두 번 → 둘 다 사람, 세 번째에서 앞 두 건까지 burst
    const b9 = await sendLog("B9", 3600);
    await recordClick(b9, "https://x.invalid", undefined, CH);
    await recordClick(b9, "https://x.invalid", undefined, CH);
    const before = await rows(b9);
    await recordClick(b9, "https://x.invalid", undefined, CH);
    const after = await rows(b9);
    check("B9 두 건까진 사람", before.every((r) => !r.isBot), before);
    check("B9 세 번째에 셋 다 burst", after.length === 3 && after.every((r) => r.reason === "burst"), after);

    // B10: 동시 5건 → 모두 burst / 동시 2건 → 둘 다 사람
    const b10 = await sendLog("B10", 3600);
    await Promise.all(Array.from({ length: 5 }, () => recordClick(b10, "https://x.invalid", undefined, CH)));
    const r10 = await rows(b10);
    check("B10 동시 5건 모두 burst", r10.length === 5 && r10.every((r) => r.reason === "burst"), r10.map((r) => r.reason));
    const b10b = await sendLog("B10b", 3600);
    await Promise.all([recordClick(b10b, "https://x.invalid", undefined, CH), recordClick(b10b, "https://x.invalid", undefined, CH)]);
    const r10b = await rows(b10b);
    check("B10 동시 2건 둘 다 사람", r10b.length === 2 && r10b.every((r) => !r.isBot), r10b.map((r) => r.reason));

    // B11: curl → ua 유지, 뒤 두 건 burst
    const b11 = await sendLog("B11", 3600);
    await recordClick(b11, "https://x.invalid", undefined, "curl/8.4.0");
    await recordClick(b11, "https://x.invalid", undefined, CH);
    await recordClick(b11, "https://x.invalid", undefined, CH);
    const r11 = await rows(b11);
    check("B11 ua 유지, 나머지 burst", r11.map((r) => r.reason).join() === "ua,burst,burst", r11.map((r) => r.reason));

    // 없는 발송 → null
    check("없는 발송 null", (await recordClick(2_000_000_000, "https://x.invalid", undefined, CH)) === null, null);

    // B25: 사이트 행동 신호
    const [site] = (await db.execute(sql`INSERT INTO tracker_sites(org_id, workspace_id, name, api_key) VALUES (${ORG}::uuid, 1, 'fx', 'fx-key-same') RETURNING id`)) as unknown as { id: number }[];
    const [osite] = (await db.execute(sql`INSERT INTO tracker_sites(org_id, workspace_id, name, api_key) VALUES (${OTHER}::uuid, 2, 'fx2', 'fx-key-other') RETURNING id`)) as unknown as { id: number }[];
    async function session(siteId: number, orgId: string, clickId: string, types: string[]) {
        const [v] = (await db.execute(sql`INSERT INTO tracker_visitors(org_id, site_id, visitor_id) VALUES (${orgId}::uuid, ${siteId}, ${"v-" + clickId}) RETURNING id`)) as unknown as { id: number }[];
        const [s] = (await db.execute(sql`INSERT INTO tracker_sessions(site_id, visitor_id, session_key, click_id) VALUES (${siteId}, ${v.id}, ${"s-" + clickId}, ${clickId}) RETURNING id`)) as unknown as { id: number }[];
        for (const t of types) await db.execute(sql`INSERT INTO tracker_events(site_id, session_id, visitor_id, event_type) VALUES (${siteId}, ${s.id}, ${v.id}, ${t})`);
    }
    await session(site.id, ORG, h1[0].clickId, ["PAGE_VIEW", "CLICK"]);          // 사람 클릭 + CLICK → true
    await session(site.id, ORG, a8[0].clickId, ["CUSTOM"]);                      // 봇 클릭 + CUSTOM → true (봇 판정과 무관)
    await session(site.id, ORG, e1[0].clickId, ["SECTION_VIEW", "PAGE_VIEW"]);   // 영역·페이지만 → false
    await session(osite.id, OTHER, r11[1].clickId, ["CLICK"]);                   // 다른 조직 사이트 → false
    const sig = await clickSignalsForSendLogs(ORG, [h, a, e, b11, b10]);
    check("B25 사람+CLICK true", sig.get(h)?.hasSiteAction === true, sig.get(h));
    check("B25 봇+CUSTOM true", sig.get(a)?.hasSiteAction === true, sig.get(a));
    check("B25 SECTION/PAGE만 false", sig.get(e)?.hasSiteAction === false, sig.get(e));
    check("B25 다른 조직 사이트 false", sig.get(b11)?.hasSiteAction === false, sig.get(b11));
    check("B20 사람/봇 수", sig.get(h)?.clickCount === 1 && sig.get(h)?.botClickCount === 1 && sig.get(b10)?.clickCount === 0 && sig.get(b10)?.botClickCount === 5, { h: sig.get(h), b10: sig.get(b10) });
    check("다른 조직으로 조회하면 비어 있음", (await clickSignalsForSendLogs(OTHER, [h, a])).size === 0, null);

    console.log(results.join("\n"));
    console.log(results.some((r) => r.startsWith("FAIL")) ? "RESULT: FAIL" : "RESULT: ALL PASS");
}
main().catch((e) => { console.error(e); process.exitCode = 1; }).finally(() => queryClient.end());
