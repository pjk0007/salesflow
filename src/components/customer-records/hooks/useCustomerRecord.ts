"use client";
import useSWR from "swr";
import { recordRequest, recordWrite } from "../api";
import type { CustomerDetail, CustomerRecord } from "../types";
export function useCustomerRecord(
    workspaceId: number,
    resource: "contacts" | "companies",
    id: string,
    before?: string,
) {
    const path = `/api/customer-crm/${resource}/${id}`;
    const state = useSWR<CustomerDetail>(
        `${path}?workspaceId=${workspaceId}${before ? `&before=${before}` : ""}`,
        recordRequest,
        { refreshInterval: 15000, refreshWhenHidden: false },
    );
    return {
        ...state,
        archive: (
            action: "archive" | "restore",
            version: number,
            reason: string,
        ) =>
            recordWrite<{ item: CustomerRecord; cancelledWorkflows: number }>(
                path,
                { workspaceId, action, version, reason },
            ),
    };
}
