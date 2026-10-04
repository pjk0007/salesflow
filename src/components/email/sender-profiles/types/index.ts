import type { SenderLimitSettings } from "@/lib/email-sender-limit-rules";

export type { SenderLimitSettings };

export interface ApiResult<T> {
    success: boolean;
    data?: T;
    error?: string;
}

/**
 * GET /api/email/sender-profiles 한 줄. 날짜 칸은 JSON이라 문자열로 온다.
 * 한도 칸은 서버가 마이그레이션 0071 뒤에 함께 내려준다 — 화면은 toLimitSettings로 읽어서 빠진 칸이 있어도 "꺼짐"으로 본다.
 */
export interface SenderProfile extends SenderLimitSettings {
    id: number;
    orgId: string;
    name: string;
    fromName: string;
    fromEmail: string;
    isDefault: boolean;
    createdAt: string;
    updatedAt: string;
}

export interface SenderProfileInput {
    name: string;
    fromName: string;
    fromEmail: string;
}

/** 화면에서 보내는 한도 칸. 웜업 시작일은 서버가 정하므로 보내지 않는다 */
export type SenderLimitPatch = Partial<Omit<SenderLimitSettings, "warmupStartedOn">>;

export type SenderProfileCreate = SenderProfileInput & SenderLimitPatch;

export type SenderProfileUpdate = Partial<SenderProfileInput & { isDefault: boolean }> & SenderLimitPatch;

/**
 * GET /api/email/sender-profiles/usage 한 줄 — 서버 `SenderUsageView`(email-sender-limit.ts)와 같은 모양.
 * 그 파일은 DB를 불러오므로 화면에서 import하지 않고 모양만 맞춘다.
 */
export interface SenderUsageView {
    profileId: number;
    /** 사용량을 센 한국 날짜 "YYYY-MM-DD" */
    usageDate: string;
    sentToday: number;
    cap: number | null;
    /** 오늘 한도 중 문의 몫 (10% 올림, 한도 1 이하·없음이면 0). 0072 이전 서버 응답에는 없다 */
    inboundReserve?: number;
    warmupDay: number | null;
    schedule: Array<{ date: string; cap: number | null }>;
}

/**
 * GET /api/email/send-queue/stats 의 규칙(AI 규칙) 한 줄. 날짜는 JSON이라 문자열로 온다.
 * 용량은 대량 몫(문의 몫을 뺀 양) 기준이고, 예상 소진일은 지금 쌓인 양만 센다 (새로 들어올 양은 모른다).
 */
export interface SendQueueRuleStats {
    linkId: number;
    partitionId: number;
    /** 대기 통수. inbound = 문의(한 건씩 생긴 레코드·수동)가 막혀 미뤄진 줄, bulk = 가져오기·예약 등록·후속·반복 */
    pending: { total: number; inbound: number; bulk: number };
    /** 가장 오래 기다린 줄의 예정 시각 (ISO). 대기가 없으면 null */
    oldestScheduledAt: string | null;
    capacity: {
        /**
         * 앞으로 14일 중 하루라도 한도 없는 주소가 보낼 수 있는 날이 있음(레거시 설정 발신자·발신자 없음 포함) —
         * 용량 "제한 없음", 예상 소진일·경고 없음
         */
        unlimited: boolean;
        /** 오늘 대량이 쓸 수 있는 양 (문의 몫이 풀리기 전(보통 15:00 KST 전) = 대량 몫 합계, 풀린 뒤 = 한도 합계). null = 제한 없음 */
        today: number | null;
        /** 오늘 지금부터 대량이 더 보낼 수 있는 양. null = 제한 없음 */
        todayRemaining: number | null;
        /** 앞으로 14일의 하루 용량 ("YYYY-MM-DD"). cap = 대량 몫, total = 한도 합계, null = 제한 없음 */
        schedule: Array<{ date: string; cap: number | null; total?: number | null }>;
    };
    /** 지금 쌓인 대기가 다 나가는 한국 날짜 "YYYY-MM-DD". 한도 없음이거나 14일 안에 못 끝나면 null */
    etaDate: string | null;
    /** 대기 ÷ 오늘~내일(보낼 수 있는 앞의 두 날) 평균 하루 용량. 한도 없음이거나 보낼 수 있는 날이 없으면 null */
    backlogDays: number | null;
    /** backlogDays > 3, 또는 대기가 있는데 보낼 수 있는 날이 없음 (backlogDays null) */
    warning: boolean;
}

export interface SendQueueStats {
    rules: SendQueueRuleStats[];
    totals: { pending: number; warnings: number };
}

/** 발송 이력 한 줄의 보낸 주소 (GET /api/email/logs). 프로필이 지워졌거나 기록이 없으면 null */
export interface LogSenderProfile {
    id: number;
    name: string;
    fromEmail: string;
}

/**
 * 대화상자의 한도 입력 칸.
 * 숫자 칸은 "비움 = 제한 없음"을 그대로 담으려고 문자열로 든다.
 * 시간대는 켜고 끄는 스위치와 시각을 따로 두어, 껐다 켜도 고른 시각이 남게 한다.
 */
export interface SenderLimitForm {
    dailyLimit: string;
    warmupEnabled: boolean;
    warmupStartCount: string;
    warmupStep: string;
    windowEnabled: boolean;
    sendWindowStart: number;
    sendWindowEnd: number;
    weekdaysOnly: boolean;
    spreadEvenly: boolean;
    isPaused: boolean;
    /** 웜업을 켤 때 화면이 권장값으로 채운 칸. 웜업을 다시 끄면 그대로인 칸만 되돌린다. 저장하지 않는다 */
    warmupAutoFill?: WarmupAutoFill | null;
}

/** 웜업을 켜며 채운 값. null인 칸은 사용자가 이미 정해 두어 건드리지 않았다 */
export interface WarmupAutoFill {
    dailyLimit: string | null;
    window: { start: number; end: number } | null;
    weekdaysOnly: boolean;
}

/** 한도 입력 칸 가운데 오류를 붙일 자리. general은 칸을 특정하지 못한 오류 (화면에서 만들 수 없는 값) */
export type LimitField = "dailyLimit" | "warmupStartCount" | "warmupStep" | "window" | "spreadEvenly" | "general";

/**
 * POST /api/email/send 결과의 errors 한 줄 — 보내지 않은 레코드와 이유.
 * email·code는 나중에 더한 칸이라 옛 응답에는 없다 (화면은 없으면 레코드 번호로 보인다).
 */
export interface SendErrorEntry {
    recordId: number;
    error: string;
    /** 레코드의 수신 이메일 칸 값 (문자열일 때만) */
    email?: string | null;
    /** 레코드 통합 코드 (예: DH-0002) */
    code?: string | null;
}
