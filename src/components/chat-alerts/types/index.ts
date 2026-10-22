/** 조직에 등록한 구글챗 스페이스 (웹훅 주소는 서버가 가려서 webhookHint로만 준다) */
export interface ChatSpaceItem {
    id: number;
    name: string;
    webhookHint: string;
    partitionCount: number;
    createdAt: string;
}

export interface ChatSpaceInput {
    name: string;
    /** 수정할 때 비워 두면 기존 주소를 그대로 쓴다 */
    webhookUrl?: string;
}
