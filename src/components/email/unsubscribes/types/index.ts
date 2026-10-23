export interface UnsubscribeEntry {
    id: number;
    email: string;
    workspaceId: number | null;
    workspaceName: string | null;
    source: string;
    reason: string | null;
    unsubscribedAt: string;
}

export interface UnsubscribeList {
    items: UnsubscribeEntry[];
    totalCount: number;
    page: number;
    pageSize: number;
    canManage: boolean;
}

export interface UnsubscribeTarget {
    query: string;
    kind: "email" | "domain";
}

export interface UnsubscribeLookupResult extends UnsubscribeTarget {
    status: "blocked" | "not_found" | "domain_matches" | "domain_empty";
    items: UnsubscribeEntry[];
    totalCount: number;
}
