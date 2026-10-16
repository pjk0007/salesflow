export const eventLabels: Record<string, string> = {
    "contact.created": "고객 등록",
    "contact.updated": "고객 정보 변경",
    "company.created": "회사 등록",
    "company.updated": "회사 정보 변경",
    "customer.event": "고객 행동 이벤트",
    "conversation.created": "상담 시작",
    "conversation.updated": "상담 상태·담당 변경",
    "conversation.identified": "비회원 상담의 회원 연결",
    "message.created": "공개 메시지 도착",
    "deal.created": "딜 생성",
    "deal.updated": "딜 변경",
    "task.created": "후속 업무 생성",
    "task.updated": "후속 업무 변경",
    "ai.handoff": "AI에서 사람 응대로 전환",
};
export const runLabels: Record<string, string> = {
    queued: "실행 대기",
    running: "처리 중",
    waiting: "예약 대기",
    retry: "재시도 대기",
    succeeded: "완료",
    skipped: "조건에 따라 제외",
    failed: "확인 필요",
    cancelled: "중단됨",
};
export function workflowEventLabel(event: {
    type: string;
    customerName?: string | null;
    payload: Record<string, unknown>;
}) {
    const data = event.payload.data as
        | Record<string, Record<string, unknown>>
        | undefined;
    const summary =
        data?.event?.name ??
        data?.message?.body ??
        data?.contact?.name ??
        data?.company?.name ??
        data?.deal?.title ??
        data?.task?.title;
    return [
        event.customerName,
        eventLabels[event.type] ?? event.type,
        summary ? String(summary).slice(0, 65) : null,
    ]
        .filter(Boolean)
        .join(" · ");
}
export const conditionFields: Record<string, string> = {
    "event.type": "시작 이벤트 종류",
    "event.data.event.name": "고객 행동 이름",
    "event.data.event.properties.page": "방문한 페이지",
    "event.data.message.kind": "메시지를 보낸 쪽",
    "event.data.message.body": "문의·답변 내용",
    "contact.lifecycleStage": "고객 단계",
    "contact.isInternal": "내부 고객 여부",
    "contact.attributes.tier": "고객 관심 등급",
    "company.name": "회사 이름",
    "company.attributes.tier": "회사 관심 등급",
    "conversation.status": "상담 상태",
    "conversation.priority": "중요 상담 여부",
    "conversation.tags": "상담 태그",
    "conversation.teamId": "상담팀 번호",
    "conversation.assigneeId": "담당자 번호",
    "conversation.aiState": "상담 응대 방식",
    "deal.stageId": "딜 단계 번호",
    "deal.amount": "딜 금액",
    "task.status": "후속 업무 상태",
};
export const conditionChoices: Record<string, Record<string, string>> = {
    "event.data.message.kind": { customer: "고객", reply: "상담원·자동 안내" },
    "contact.lifecycleStage": {
        lead: "리드",
        prospect: "잠재 고객",
        customer: "고객",
        inactive: "비활성",
    },
    "conversation.status": {
        open: "진행중",
        snoozed: "보류중",
        closed: "종료됨",
    },
    "conversation.aiState": { auto: "자동 응대 허용", human: "사람 응대" },
    "task.status": { open: "진행중", done: "완료", cancelled: "취소" },
};
