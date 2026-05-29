import { z } from "zod";

const eventSchema = z.object({
    type: z.enum([
        "PAGE_VIEW",
        "CUSTOM",
        "PURCHASE",
        "HEARTBEAT",
        "SESSION_END",
        "CLICK",
        "SECTION_VIEW",
    ]),
    name: z.string().max(100).optional().nullable(),
    page_url: z.string().max(2000).optional().nullable(),
    page_title: z.string().max(500).optional().nullable(),
    properties: z.record(z.string(), z.unknown()).optional().nullable(),
    revenue: z.number().optional().nullable(),
});

const sessionSchema = z.object({
    landing_page: z.string().max(2000).optional().nullable(),
    traffic_source: z.string().max(20).optional().nullable(),
    referrer: z.string().max(2000).optional().nullable(),
    utm_source: z.string().max(100).optional().nullable(),
    utm_medium: z.string().max(100).optional().nullable(),
    utm_campaign: z.string().max(200).optional().nullable(),
    utm_term: z.string().max(200).optional().nullable(),
    utm_content: z.string().max(200).optional().nullable(),
});

const deviceSchema = z.object({
    type: z.enum(["desktop", "mobile", "tablet"]).optional(),
    browser: z.string().max(50).optional(),
    os: z.string().max(50).optional(),
});

/**
 * tracker.js → /api/tracker/collect 페이로드 검증 (단건).
 */
export const collectEventSchema = z.object({
    visitor_id: z.string().min(1).max(64),
    session_key: z.string().min(1).max(64),
    click_id: z.string().max(64).optional().nullable(),
    event: eventSchema,
    session: sessionSchema.optional().nullable(),
    device: deviceSchema.optional().nullable(),
});

export type CollectEventPayload = z.infer<typeof collectEventSchema>;

/**
 * 배치 페이로드 — sendBeacon으로 unload 시점에 SECTION_VIEW 등 여러 이벤트를 한 번에 전송.
 * 모든 이벤트가 같은 visitor/session 컨텍스트라고 가정.
 */
export const collectBatchSchema = z.object({
    visitor_id: z.string().min(1).max(64),
    session_key: z.string().min(1).max(64),
    click_id: z.string().max(64).optional().nullable(),
    events: z.array(eventSchema).min(1).max(50),
    session: sessionSchema.optional().nullable(),
    device: deviceSchema.optional().nullable(),
});

export type CollectBatchPayload = z.infer<typeof collectBatchSchema>;

/**
 * sendb.identify() → /api/tracker/identify 페이로드 검증.
 */
export const identifyPayloadSchema = z
    .object({
        visitor_id: z.string().min(1).max(64),
        email: z.string().email().max(200).optional(),
        user_id: z.string().max(100).optional(),
        name: z.string().max(100).optional(),
        phone: z.string().max(20).optional(),
    })
    .refine((d) => Boolean(d.email || d.user_id), {
        message: "email 또는 user_id가 필요합니다.",
    });

export type IdentifyPayload = z.infer<typeof identifyPayloadSchema>;

/**
 * 트래커 사이트 생성 요청 검증.
 */
export const createSiteSchema = z.object({
    name: z.string().min(1).max(200),
    domains: z
        .array(z.string().min(1).max(253))
        .min(1, "도메인을 최소 1개 등록해주세요.")
        .max(20),
    // identify 매칭 필드 (선택) — 비우면 email/phone 기본
    matchField: z.string().max(100).optional().nullable(),
});

export type CreateSitePayload = z.infer<typeof createSiteSchema>;

/**
 * 트래커 사이트 수정 요청 검증.
 */
export const updateSiteSchema = z.object({
    name: z.string().min(1).max(200).optional(),
    domains: z.array(z.string().min(1).max(253)).max(20).optional(),
    isActive: z.union([z.literal(0), z.literal(1)]).optional(),
    matchField: z.string().max(100).optional().nullable(),
    // 분석 제외 경로 prefix 배열 — 빈 배열 허용
    excludePaths: z.array(z.string().min(1).max(200)).max(50).optional(),
    // 전환 완료 단계명 (record.data.matchStep 값) — 디하=구독중. 빈 문자열이면 NULL
    conversionStage: z.string().max(100).optional().nullable(),
});

export type UpdateSitePayload = z.infer<typeof updateSiteSchema>;
