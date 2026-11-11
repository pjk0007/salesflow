export interface SalesMember {
    id: string;
    name: string;
}

export interface ActionItem {
    id: number;
    recordId: number;
    meetingId: number | null;
    content: string;
    ownerId: string | null;
    ownerName: string | null;
    dueAt: string | null;
    doneAt: string | null;
    createdAt: string;
}

export interface Meeting {
    id: number;
    metAt: string;
    title: string | null;
    attendees: string | null;
    notes: string | null;
    transcript: string | null;
    summary: string | null;
    audioUrl: string | null;
    /** 처음 기록한 리드 */
    recordId: number;
    /** 이 미팅이 보이는 리드 전체 (처음 기록한 리드 + 함께 참석한 같은 기업 담당자) */
    linkedRecordIds: number[];
    createdBy: string | null;
    createdByName: string | null;
    createdAt: string;
}

/** 미팅 작성 화면의 액션플랜 한 줄 (저장 전) */
export interface DraftActionItem {
    content: string;
    ownerId: string | null;
    dueDate: string;
}

export interface CardFields {
    name: string | null;
    companyName: string | null;
    title: string | null;
    email: string | null;
    phone: string | null;
    website: string | null;
    address?: string | null;
}
