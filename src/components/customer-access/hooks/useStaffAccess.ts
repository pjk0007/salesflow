"use client";
import useSWR from "swr";
import { accessRequest, accessWrite } from "../api";
import type { AccessRoster } from "../types";
import type { WorkspaceRole } from "@/lib/customer-access/rules";
export function useStaffAccess(workspaceId: number, before?: string) {
    const path = `/api/customer-platform/access?workspaceId=${workspaceId}`;
    const state = useSWR<AccessRoster>(
        path + (before ? `&before=${before}` : ""),
        accessRequest,
    );
    return {
        ...state,
        save: (userId: string, role: WorkspaceRole, version: number) =>
            accessWrite(path, { userId, role, version }),
    };
}
