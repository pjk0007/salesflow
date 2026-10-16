import type { InboxBootstrap } from "@/components/inbox/types";
export function workspaceAbilities(
    bootstrap: InboxBootstrap | undefined,
    id: number | null | undefined,
) {
    return (
        bootstrap?.workspaces.find((w) => w.id === id)?.abilities ?? {
            read: false,
            respond: false,
            manage: false,
        }
    );
}
export const roleNames = {
    none: "접근 없음",
    viewer: "열람",
    agent: "응대·편집",
    manager: "운영 관리",
};
