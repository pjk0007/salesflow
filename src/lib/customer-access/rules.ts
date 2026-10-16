export const workspaceRoles = ["none", "viewer", "agent", "manager"] as const;
export type WorkspaceRole = (typeof workspaceRoles)[number];
export type CustomerCapability = "read" | "respond" | "manage";
const ranks: Record<WorkspaceRole, number> = {
    none: 0,
    viewer: 1,
    agent: 2,
    manager: 3,
};
export function permitsCustomerRole(
    role: WorkspaceRole,
    capability: CustomerCapability,
) {
    return ranks[role] >= { read: 1, respond: 2, manage: 3 }[capability];
}
export function customerAbilities(role: WorkspaceRole) {
    return {
        read: permitsCustomerRole(role, "read"),
        respond: permitsCustomerRole(role, "respond"),
        manage: permitsCustomerRole(role, "manage"),
    };
}
