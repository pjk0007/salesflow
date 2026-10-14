import type { WorkspaceRole } from "@/lib/customer-access/rules";
export interface AccessRoster {
    members: {
        id: string;
        name: string;
        email: string;
        orgRole: string;
        active: number;
        role: WorkspaceRole;
        version: number;
    }[];
    history: {
        id: string;
        name: string;
        actorName: string;
        beforeRole: WorkspaceRole;
        afterRole: WorkspaceRole;
        version: number;
        createdAt: string;
    }[];
    hasMore: boolean;
}
