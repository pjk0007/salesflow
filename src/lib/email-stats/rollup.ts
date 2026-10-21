import { acceptedSendConditionSql } from "../email-send-log-status";
import { fillAttribution } from "./attribution-store";
import { executeSql, type StatsConn } from "./connection";
import { recomputeLeads } from "./leads";
import { recomputeRecords } from "./records";
import { rollupSql } from "./sql";
import type { DateRange } from "./rules";

export async function recomputeRange(conn: StatsConn, orgId: string, range: DateRange, options: {
    records?: boolean;
    leads?: boolean;
} = {}) {
    const attrInserted = await fillAttribution(conn, orgId, range);
    const email = await executeSql(conn, rollupSql(orgId, range, acceptedSendConditionSql()));
    const leads = options.leads === false ? { written: 0, deleted: 0 } : await recomputeLeads(conn, orgId, range);
    const records = options.records === false ? { written: 0, deleted: 0 } : await recomputeRecords(conn, orgId, range);
    return {
        attrInserted,
        written: email.written + leads.written + records.written,
        deleted: email.deleted + leads.deleted + records.deleted
    };
}
