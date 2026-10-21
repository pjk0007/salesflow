import postgres from "postgres";
import { randomUUID } from "node:crypto";
import { addDaysYmd } from "../kst";
export const NOW = new Date("2026-10-21T03:00:00Z");
export const ALL_DAYS = { from: "2026-08-01", to: "2026-10-21" };

export function qaUrl(): string | undefined {
    const value = process.env.EMAIL_STATS_TEST_URL;
    if (!value)
        return undefined;
    const url = new URL(value);
    if (url.protocol !== "postgresql:" || url.hostname !== "127.0.0.1" || url.port !== "5432" || url.pathname !== "/sendb_email_stats_qa" || url.search || url.hash)
        throw new Error("Email stats tests require the isolated 127.0.0.1:5432/sendb_email_stats_qa database.");
    return value;
}

export async function openQa() {
    const url = qaUrl();
    if (!url)
        throw new Error("EMAIL_STATS_TEST_URL is required");
    process.env.DATABASE_URL = url;
    const c = postgres(url, { max: 1, onnotice: () => { } });
    await c`SELECT pg_advisory_lock(154740121)`;
    const { runMigrations } = await import("../db/migrate");
    if (!await runMigrations()) {
        await c.end();
        throw new Error("QA migration failed");
    }
    return c;
}
export interface FixtureOrg {
    orgId: string;
    workspaceId: number;
    recordId: number;
    ids: number[];
    dates: string[];
}

export async function fixture(c: postgres.Sql): Promise<FixtureOrg[]> {
    const [database] = await c<{
        name: string;
    }[]> `SELECT current_database() AS name`;
    if (database.name !== "sendb_email_stats_qa") {
        throw new Error("fixture requires sendb_email_stats_qa");
    }
    await c.unsafe("TRUNCATE email_send_logs, organizations RESTART IDENTITY CASCADE");
    const orgs: FixtureOrg[] = [];
    for (let n = 0;n < 3;n++) {
        const orgId = randomUUID();
        await c`INSERT INTO organizations(id,name,slug) VALUES(${orgId},'QA',${orgId})`;
        const [w] = await c`INSERT INTO workspaces(org_id,name) VALUES(${orgId},'QA') RETURNING id`;
        const [p] = await c`INSERT INTO partitions(workspace_id,name) VALUES(${w.id},'QA') RETURNING id`;
        const [r] = await c`INSERT INTO records(org_id,workspace_id,partition_id,created_at) VALUES(${orgId},${w.id},${p.id},'2026-08-01T00:00:00+09:00')
            RETURNING id`;
        const [tpl] = await c`INSERT INTO email_templates(org_id,name,subject,html_body) VALUES(${orgId},'QA','QA','QA') RETURNING id`;
        const [link] = await c`INSERT INTO email_template_links(partition_id,name,email_template_id,recipient_field) VALUES(${p.id},'QA',
            ${tpl.id},'email') RETURNING id`;
        const [ai] = await c`INSERT INTO email_auto_personalized_links(org_id,partition_id,recipient_field,company_field) VALUES(${orgId},
            ${p.id},'email','company') RETURNING id`;
        const ids: number[] = [], dates: string[] = [];
        for (let i = 0;i < 20;i++) {
            const days = [50, 20, 3, 1, 0, 49, 30, 10][i % 8];
            const date = addDaysYmd("2026-10-21", -days);
            dates.push(date);
            const parent = i > 0 && i < 5 ? ids[i - 1] : i === 5 ? 999999 : i === 6 && n > 0 ? orgs[0].ids[0] : null;
            const statuses = [
                "sent", "sent", "sent", "sent", "sent", "failed",
                "pending", "uncertain", "rejected", "sent", "failed", "sent", "sent", "sent", "sent", "demo", "cancelled", "sent", "sent", "sent"
            ];
            const codes = [
                "SST2", "SST2", "SST2", "SST2", "SST2", "SST3", null, null, null, "SST5", "SST7", "SST8", "SST2", null, "SST2", null, null, "SST2", "SST2", "SST2"
            ];
            const trigger = i === 17 ? "test_followup" : i === 18 ? "journey_demo" : i === 19 ? "testX" : i > 0 && i < 5 ? "followup" : "manual";
            const [log] = await c`INSERT INTO email_send_logs(org_id,partition_id,record_id,recipient_email,status,trigger_type,sent_at,parent_log_id,
            auto_personalized_link_id,template_link_id,email_template_id,sender_email,request_id,nhn_status_code,
            delivery_fail_source,delivery_status_code,open_tracked)
                VALUES(${orgId},${p.id},${r.id},${`qa-${i}@example.invalid`},
                    ${statuses[i]},${trigger},${date + "T12:00:00+09:00"},${parent},
                    ${i === 0 ? ai.id : null},${i === 1 || i === 7 ? link.id : null},${tpl.id},
                    'qa@example.invalid',${i === 8 ? null : "qa-request-" + i},${codes[i]},
                    ${i === 12 ? "dsn" : null},${i === 5 || i === 12 ? "5.1.1" : null},${i !== 14})
                RETURNING id`;
            ids.push(log.id);
            if (i % 3 === 0)
                await c`INSERT INTO email_open_logs(org_id,send_log_id,is_machine,opened_at) VALUES(${orgId},${log.id},${i % 2 === 1},
            '2026-10-21T03:00:00Z')`;
            if (i % 4 === 0)
                await c`INSERT INTO email_click_logs(org_id,send_log_id,url,is_bot,click_id,clicked_at) VALUES(${orgId},${log.id},'https://example.invalid',
            ${i === 4},${"qa-" + log.id},'2026-10-21T03:00:00Z')`;
        }
        for (const [i, kind] of [[2, "human"], [3, "auto_reply"], [5, "bounce"]] as const)
            await reply(c, orgId, ids[i], kind, i === 2 ? ids[0] : null);
        for (const [i, source] of [[0, "link"], [1, "one_click"], [2, "manual"]] as const)
            await c`INSERT INTO email_unsubscribes(org_id,workspace_id,email,send_log_id,source) VALUES(${orgId},${w.id},${`qa-${i}@example.invalid`},${ids[i]},${source})`;
        await c`INSERT INTO email_bounce_signals(org_id,send_log_id,recipient_email,sender_email,kind,gmail_message_id,received_at)
            VALUES(${orgId},${ids[0]},'qa@example.invalid','sender@example.invalid','complaint',${randomUUID()},
            '2026-10-21T03:00:00Z')`;
        if (n < 2) {
            const [site] = await c`INSERT INTO tracker_sites(org_id,workspace_id,name,api_key) VALUES(${orgId},${w.id},'QA',${randomUUID()}) RETURNING
            id`;
            const [visitor] = await c`INSERT INTO tracker_visitors(org_id,site_id,visitor_id) VALUES(${orgId},${site.id},${randomUUID()}) RETURNING
            id`;
            for (let k = 0;k < 3;k++) {
                const [session] = await c`INSERT INTO tracker_sessions(site_id,visitor_id,session_key,click_id) VALUES(${site.id},${visitor.id},${randomUUID()},
            ${"qa-" + ids[k === 2 ? 4 : 0]}) RETURNING id`;
                await c`INSERT INTO tracker_events(site_id,session_id,visitor_id,event_type) VALUES(${site.id},${session.id},${visitor.id},
            ${k === 0 ? "CLICK" : "CUSTOM"})`;
                const message = {
                    journeyPriority: {
                        version: "1",
                        rankEligible: "true",
                        customerKey: "a".repeat(64),
                        tier: k === 0 ? "highlight" : "urgent"
                    }
                };
                await c`INSERT INTO customer_journey_alerts(org_id,workspace_id,record_id,session_id,last_activity_at,stage,message,
            status,created_at) VALUES(${orgId},${w.id},${r.id},${session.id},${NOW},'QA',${c.json(message)},${k === 2 ? "skipped" : "sent"},
            '2026-10-18T03:00:00Z')`;
            }
            await c`INSERT INTO journey_lead_followups(org_id,workspace_id,customer_key,record_id,status) VALUES(${orgId},${w.id},
            ${"a".repeat(64)},${r.id},'new')`;
        }
        orgs.push({ orgId, workspaceId: w.id, recordId: r.id, ids, dates });
    }
    return orgs;
}

export async function reply(c: postgres.Sql, orgId: string, id: number, kind = "human", root: number | null = null) {
    await c`INSERT INTO email_replies(org_id,send_log_id,root_log_id,mailbox,gmail_message_id,from_email,to_email,contact_email,
            kind,ours_reason,match_status,received_at,detected_mode)
    VALUES(${orgId},${id},${root},'qa@example.invalid',${randomUUID()},'from@example.invalid','to@example.invalid',
            'from@example.invalid',${kind},'address','matched','2026-10-21T03:00:00Z','dry_run')`;
}

export async function addEvents(c: postgres.Sql, org: FixtureOrg, id: number) {
    await c`INSERT INTO email_open_logs(org_id,send_log_id,is_machine,opened_at) VALUES(${org.orgId},${id},false,'2026-10-21T03:00:00Z')`;
    await c`INSERT INTO email_click_logs(org_id,send_log_id,url,is_bot,clicked_at) VALUES(${org.orgId},${id},'https://example.invalid',
            false,'2026-10-21T03:00:00Z')`;
    await reply(c, org.orgId, id);
    await c`INSERT INTO email_unsubscribes(org_id,workspace_id,email,send_log_id,source) VALUES(${org.orgId},${org.workspaceId},
            ${randomUUID() + "@example.invalid"},${id},'link')`;
}
