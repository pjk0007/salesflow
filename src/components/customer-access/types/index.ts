import type { WorkspaceRole } from "@/lib/customer-access/rules";
export interface AccessRoster {
    members: {
        /** 이 직원이 작성한 발송 대기 메일 답장 수(응대 권한을 빼면 취소된다) */
        pendingEmailReplies?: number;
        id: string;
        name: string;
        email: string;
        orgRole: string;
        active: number;
        role: WorkspaceRole;
        version: number;
        /** 이 직원이 게시해 지금 켜져 있는 자동화 수(게시자 권한으로 실행됨) */
        publishedWorkflows?: number;
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
