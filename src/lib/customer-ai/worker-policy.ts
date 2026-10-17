type WorkerEnvironment = {
    NODE_ENV?: string;
    CUSTOMER_AI_WORKER?: string;
    CUSTOMER_AI_WORKSPACES?: string;
};

// An omitted scope preserves existing deployments; an invalid explicit scope
// must never accidentally enable automatic replies for every workspace.
export function supportWorkerWorkspaces(value?: string): number[] | null {
    if (value === undefined) return null;
    const parts = value.split(",").map((part) => part.trim());
    if (parts.some((part) => !/^[1-9]\d*$/.test(part))) return [];
    const ids = parts.map(Number);
    return ids.every(Number.isSafeInteger) ? [...new Set(ids)] : [];
}

export function supportWorkerEnabled(
    environment: WorkerEnvironment,
    workspaceId?: number,
): boolean {
    if (
        environment.NODE_ENV !== "production" ||
        environment.CUSTOMER_AI_WORKER !== "on"
    )
        return false;
    const scope = supportWorkerWorkspaces(environment.CUSTOMER_AI_WORKSPACES);
    return (
        scope === null ||
        (workspaceId === undefined
            ? scope.length > 0
            : scope.includes(workspaceId))
    );
}
