/**
 * 발신 건강 화면 타입 — GET /api/email/send-health 응답 (서버 src/lib/sender-health-view.ts의 SendHealthView와 같은 모양).
 * 그 파일은 DB를 불러오므로 화면에서 import하지 않고 모양만 맞춘다. 날짜는 JSON이라 ISO 문자열로 온다.
 */

export type HealthState = "ok" | "caution" | "danger" | "insufficient";

export interface ApiResult<T> {
    success: boolean;
    data?: T;
    error?: string;
}

export interface SendHealthSync {
    lastOkAt: string | null;
    cursor: string | null;
    initialDoneAt: string | null;
    lastError: string | null;
    lastErrorCode: string | null;
    /** 자동 조치를 미루는 까닭 (sync_stale | sync_initial) */
    gate: string | null;
    unconfirmedOld: number;
    /** NHN이 오래된 기간이라 거절해 건너뛴 창 누적 (OPS-7) */
    skippedWindowsTotal?: number;
    skippedWindowsLastAt?: string | null;
}

export interface PartitionHealthRow {
    partitionId: number;
    name: string;
    workspaceId: number | null;
    workspaceName: string | null;
    state: HealthState | string;
    evalWindow: "7d" | "30d" | string;
    final: number;
    failed: number;
    rateBp: number | null;
    unknown: number;
    dsnOnly: number;
    senderSide: number;
    nhnUnsub: number;
    held: boolean;
    recovered: boolean;
    unconfirmedBp: number;
    windowStart: string | null;
    evaluatedAt: string | null;
}

export interface SenderHealthRow {
    profileId: number;
    email: string;
    isDefault: boolean;
    isPaused: boolean;
    pausedSource: string | null;
    pausedReason: string | null;
    pausedAt: string | null;
    healthAction: string;
    state: HealthState | string | null;
    final: number;
    failed: number;
    rateBp: number | null;
    outliers: number;
    dsnOnly: number;
    /** 자동 멈춤을 풀면 오늘 한도 (웜업을 멈춘 날만큼 미룬 값) */
    releasePreview: { todayCap: number | null; warmupDay: number | null } | null;
}

export interface DomainHealthRow {
    domain: string;
    state: string;
    burst: boolean;
    senderSide1h: number;
    senderSide24h: number;
    final7d: number;
    rateBp: number | null;
}

export interface PartitionHoldRow {
    id: number;
    partitionId: number;
    partitionName: string;
    workspaceId: number;
    workspaceName: string | null;
    reasonText: string;
    heldAt: string | null;
    queued: number;
}

export interface HealthEventRow {
    id: number;
    kind: string;
    level: string;
    mode: string;
    action: string;
    actionNote: string | null;
    entityType: string;
    entityId: number | null;
    entityKey: string | null;
    evalWindow: string | null;
    summary: string;
    createdAt: string | null;
}

/** 구글 챗 알림 받는 곳 하나의 전달 상태 (WPN-5) */
export interface ChatDeliveryRow {
    source: string;
    workspaceId: number | null;
    workspaceName: string | null;
    label: string;
    kind: "config" | "missing" | "invalid" | "unreachable" | null;
    problemText: string | null;
    lastStatus: number | null;
    lastError: string | null;
    problemSince: string | null;
    lastOkAt: string | null;
    lastFailAt: string | null;
    waiting: { deep: number; reply: number; health: number };
}

export interface WebhookCheckResult {
    source: string;
    label: string;
    ok: boolean;
    message: string;
}

export interface SendHealthView {
    mode: string;
    dsnInRate: boolean;
    isAdmin: boolean;
    generatedAt: string;
    healthDate: string | null;
    unavailable?: boolean;
    /** 이 조직이 발신 건강 판정 대상인가 (OPS-2). false면 카드를 숨긴다 */
    inScope?: boolean;
    sync: SendHealthSync | null;
    partitions: PartitionHealthRow[];
    senders: SenderHealthRow[];
    domains: DomainHealthRow[];
    holds: PartitionHoldRow[];
    events: HealthEventRow[];
    /** 관리자만 채워진다 */
    chatDelivery?: ChatDeliveryRow[];
}

/** 풀기 대화상자 대상 */
export type ReleaseTarget =
    | { kind: "hold"; holdId: number; name: string; queued: number }
    | { kind: "sender"; profileId: number; email: string; reason: string | null; preview: SenderHealthRow["releasePreview"] };
