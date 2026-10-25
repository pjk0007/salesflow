export const kindNames: Record<string, string> = {
    companies: "회사",
    contacts: "고객",
    pipelines: "파이프라인",
    deals: "딜",
    tasks: "할 일",
    conversations: "과거 상담",
    messages: "메시지",
};
export const sourceNames: Record<string, string> = {
    portable: "공통 이전 형식",
    channel: "채널톡 API 내보내기",
    intercom: "인터컴 API 내보내기",
    hubspot: "허브스팟 CRM 내보내기",
};
export const actionNames: Record<string, string> = {
    preview: "미리보기 생성",
    start: "실행 시작",
    pause: "일시 중지",
    resume: "재개",
    cancel: "중단",
    completed: "완료",
    failed: "실패",
    "file.ready": "첨부 저장",
    "file.failed": "첨부 실패",
    "file.source": "첨부 원본 주소 등록",
};
export const stateNames: Record<string, string> = {
    ready: "검토 대기",
    running: "이전 진행",
    paused: "일시 중지",
    failed: "실패 · 재개 가능",
    completed: "완료",
    cancelled: "중단됨",
};
export const operationNames: Record<string, string> = {
    create: "새로 생성",
    link: "기존 자료 연결",
    reuse: "기존 이전 재사용",
    update: "이전 자료 갱신",
    error: "오류 · 실행 불가",
};
export const csvFields: Record<string, string[]> = {
    companies: ["id", "name", "externalId", "domain"],
    contacts: ["id", "name", "externalId", "email", "phone", "companyIds"],
    pipelines: ["id", "name", "stages"],
    deals: [
        "id",
        "title",
        "pipelineId",
        "stageId",
        "contactId",
        "companyId",
        "amount",
        "currency",
        "notes",
    ],
    tasks: [
        "id",
        "title",
        "contactId",
        "companyId",
        "dealId",
        "status",
        "dueAt",
        "body",
    ],
    conversations: ["id", "contactId", "name", "status", "tags", "createdAt"],
    messages: [
        "id",
        "conversationId",
        "messageKind",
        "body",
        "authorName",
        "createdAt",
    ],
};
/**
 * 서버 오류·확인 문구의 영문 종류·필드명을 한국어로 바꾼다.
 * 예) "contacts/원본1: email: 입력 형식·길이를 확인해주세요." → "고객/원본1 · 이메일: 입력 형식·길이를 확인해주세요."
 * 알 수 없는 코드는 원문 그대로 둔다.
 */
export function importMessageLabel(message: string) {
    return message
        .replace(
            /^(companies|contacts|pipelines|deals|tasks|conversations|messages)(\/[^:]*)?: /,
            (_, kind: string, id = "") =>
                `${kindNames[kind] ?? kind}${id}${id ? " · " : ": "}`,
        )
        .replace(
            /(^|· )([A-Za-z][\w.]*): /,
            (whole, lead: string, field: string) =>
                fieldNames[field.split(".")[0]]
                    ? `${lead}${fieldNames[field.split(".")[0]]}: `
                    : whole,
        )
        .replace(
            /(^|\s|\()(companies|contacts|pipelines|deals|tasks|conversations|messages)(?= 원본| 자료|\/)/g,
            (_, lead: string, kind: string) => `${lead}${kindNames[kind]}`,
        );
}
export const fieldNames: Record<string, string> = {
    id: "원본 ID",
    name: "이름",
    externalId: "샌드비 외부 ID · 선택",
    domain: "회사 도메인",
    email: "이메일",
    phone: "전화번호",
    companyIds: "회사 원본 ID들 · ; 구분",
    stages: "단계 배열 · JSON",
    title: "제목",
    pipelineId: "파이프라인 원본 ID",
    stageId: "단계 원본 ID",
    contactId: "고객 원본 ID",
    companyId: "회사 원본 ID",
    amount: "금액",
    currency: "통화",
    notes: "설명",
    dealId: "딜 원본 ID",
    status: "상태",
    dueAt: "마감 시각",
    body: "내용",
    tags: "태그 · ; 구분",
    createdAt: "원래 작성 시각",
    conversationId: "상담 원본 ID",
    messageKind: "customer/reply/note",
    authorName: "원래 작성자",
};
