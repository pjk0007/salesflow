import { sql } from "drizzle-orm";
import type { KpiData, KpiKey, StatCounts, StatsQuery } from "@/components/email/dashboard/types";
import { statsEnvelope, readRows, sumColumns, statsWhere } from "./read-shared";
import { coverageStatus, deltaPct, deriveRates, emptyCounts } from "./metrics";

export async function readKpi(orgId: string, query: StatsQuery): Promise<KpiData> {
    const envelope = await statsEnvelope(orgId, query);
    const [counts, leads] = await Promise.all([
        readRows<StatCounts & {
            current: boolean;
        }>(sql`SELECT stat_date>=${query.from}::date AS current, ${sumColumns}
            FROM email_stats_daily WHERE ${statsWhere(orgId, { ...query, from: envelope.comparison.from })}
            AND grain='total' GROUP BY 1`),
        readRows<{
            current: boolean;
            total: number;
            urgent: number;
            highlight: number;
            unhandled: number;
        }>(sql`WITH people AS (
            SELECT stat_date>=${query.from}::date AS current,workspace_id,customer_key,bool_or(tier='urgent')
            AS urgent
            FROM email_stats_lead_days WHERE ${statsWhere(orgId, { ...query, from: envelope.comparison.from })}
            GROUP BY 1,2,3)
            SELECT current,count(*)::int total,count(*) FILTER(WHERE urgent)::int urgent,count(*) FILTER(WHERE
            NOT urgent)::int highlight,
            count(*) FILTER(WHERE f.id IS NULL OR f.status='new')::int unhandled FROM people p
            LEFT JOIN journey_lead_followups f ON f.org_id=${orgId}::uuid AND f.workspace_id=p.workspace_id
            AND f.customer_key=p.customer_key GROUP BY 1`),
    ]);
    const strip = (row: (StatCounts & {
        current: boolean;
    }) | undefined): StatCounts => {
        if (!row)
            return emptyCounts();
        const { current: isCurrent, ...rest } = row;
        void isCurrent;
        return rest;
    };
    const current = strip(counts.find((row) => row.current));
    const previous = strip(counts.find((row) => !row.current));
    const lead = leads.find((row) => row.current);
    const previousLead = leads.find((row) => !row.current);
    const currentCoverage = coverageStatus(query, envelope.coverage);
    const previousCoverage = coverageStatus(envelope.comparison, envelope.coverage);
    const ratio = (a: number, b: number) => b === 0 ? null : a / b * 100;
    const values = (count: StatCounts, keyLeads: number): Record<KpiKey, number | null> => ({
        sent: count.accepted,
        deliveryRate: ratio(count.delivered, count.delivered + count.bounced + count.senderSide + count.nhnUnsub),
        openRate: ratio(count.opened, count.openBase),
        clickRate: ratio(count.clicked, count.sent),
        visits: envelope.connections.site ? count.visited : null,
        replyRate: envelope.connections.reply ? ratio(count.seqReplied, count.firstSent) : null,
        keyLeads: envelope.connections.journey ? keyLeads : null,
        unsubscribeRate: ratio(count.unsubscribed, count.sent),
    });
    const a = values(current, lead?.total ?? 0), b = values(previous, previousLead?.total ?? 0);
    const kpi = Object.fromEntries((Object.keys(a) as KpiKey[]).map((key) => [
        key, {
            value: a[key] === null ? null : Math.round(a[key]! * 10) / 10,
            comparison: b[key] === null ? null : Math.round(b[key]! * 10) / 10,
            deltaPct: currentCoverage === "full" && previousCoverage === "full" ? deltaPct(a[key], b[key]) : null,
        }
    ])) as KpiData["kpi"];
    return {
        ...envelope,
        current,
        previous,
        rates: deriveRates(current),
        currentCoverage,
        previousCoverage,
        leads: {
            total: lead?.total ?? 0,
            urgent: lead?.urgent ?? 0,
            highlight: lead?.highlight ?? 0,
            unhandled: lead?.unhandled ?? 0,
            previousTotal: previousLead?.total ?? 0
        },
        kpi
    };
}
