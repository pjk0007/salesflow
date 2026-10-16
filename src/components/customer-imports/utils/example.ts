export function exampleBundle() {
    const t = "2024-05-08T01:00:00.000Z";
    return {
        companies: [
            {
                id: "company-qa",
                name: "가상 이전 기업",
                domain: "example.test",
            },
        ],
        contacts: [
            {
                id: "customer-qa",
                name: "가상 이전 고객",
                email: "import-qa@example.test",
                companyIds: ["company-qa"],
            },
        ],
        pipelines: [
            {
                id: "pipeline-qa",
                name: "이전 영업 파이프라인",
                stages: [
                    { id: "consider", name: "도입 검토", category: "open" },
                    { id: "contract", name: "계약", category: "won" },
                ],
            },
        ],
        deals: [
            {
                id: "deal-qa",
                title: "가상 이전 계약",
                pipelineId: "pipeline-qa",
                stageId: "consider",
                contactId: "customer-qa",
                companyId: "company-qa",
                amount: "1200000",
                currency: "KRW",
            },
        ],
        tasks: [
            {
                id: "task-qa",
                title: "이전 상담 후속 확인",
                contactId: "customer-qa",
                dealId: "deal-qa",
                status: "open",
            },
        ],
        conversations: [
            {
                id: "chat-qa-1",
                contactId: "customer-qa",
                name: "도입 문의 · 원본 상담",
                status: "closed",
                createdAt: t,
            },
            {
                id: "chat-qa-2",
                contactId: "customer-qa",
                name: "계약 문의 · 원본 상담",
                status: "open",
                createdAt: t,
            },
        ],
        messages: [
            {
                id: "message-qa-1",
                conversationId: "chat-qa-1",
                messageKind: "customer",
                body: "기존 서비스에서 남긴 도입 문의입니다.",
                authorName: "가상 이전 고객",
                createdAt: t,
            },
            {
                id: "message-qa-2",
                conversationId: "chat-qa-1",
                messageKind: "reply",
                body: "이전 상담원이 안내한 공개 답변입니다.",
                authorName: "가상 이전 상담원",
                createdAt: "2024-05-08T01:01:00.000Z",
                files: [{ name: "가상 제안서.pdf", id: "file-qa" }],
            },
            {
                id: "message-qa-3",
                conversationId: "chat-qa-1",
                messageKind: "note",
                body: "직원만 보는 이전 내부 메모입니다.",
                authorName: "가상 이전 상담원",
                createdAt: "2024-05-08T01:02:00.000Z",
            },
        ],
    };
}
