/**
 * 트래커 파티션의 시스템 필드 정의.
 * tracker visitor 데이터를 records 테이블에 mirror할 때 사용되는 컬럼셋.
 *
 * key는 모두 tracker_ prefix를 붙여 사용자 정의 필드와 충돌 방지.
 * (field_definitions의 unique 제약: workspace_id + key)
 *
 * sendb의 valid 필드 타입: text, number, currency, date, datetime, select, phone, email,
 * textarea, checkbox, file, formula, user_select
 */
export const TRACKER_FIELD_KEY_PREFIX = "tracker_";

export const TRACKER_SYSTEM_FIELDS: Array<{
    key: string;
    label: string;
    fieldType: string;
    isSortable: 0 | 1;
    isGroupable?: 0 | 1;
    options?: string[];
}> = [
    // 식별
    { key: "tracker_email", label: "이메일", fieldType: "email", isSortable: 1 },
    { key: "tracker_name", label: "이름", fieldType: "text", isSortable: 1 },
    { key: "tracker_visitor_id", label: "방문자 ID", fieldType: "text", isSortable: 0 },

    // 시간
    { key: "tracker_first_seen", label: "첫 방문", fieldType: "datetime", isSortable: 1 },
    { key: "tracker_last_seen", label: "마지막 방문", fieldType: "datetime", isSortable: 1 },

    // 카운터
    { key: "tracker_total_visits", label: "총 방문", fieldType: "number", isSortable: 1 },
    { key: "tracker_total_pageviews", label: "총 페이지뷰", fieldType: "number", isSortable: 1 },
    { key: "tracker_total_events", label: "총 이벤트", fieldType: "number", isSortable: 1 },

    // 디바이스
    {
        key: "tracker_device_type",
        label: "기기",
        fieldType: "select",
        isSortable: 1,
        isGroupable: 1,
        options: ["desktop", "mobile", "tablet"],
    },
    { key: "tracker_browser", label: "브라우저", fieldType: "text", isSortable: 1 },
    { key: "tracker_os", label: "OS", fieldType: "text", isSortable: 1 },

    // 유입
    { key: "tracker_first_utm_source", label: "최초 유입", fieldType: "text", isSortable: 1, isGroupable: 1 },
    { key: "tracker_first_utm_campaign", label: "최초 캠페인", fieldType: "text", isSortable: 1, isGroupable: 1 },
    { key: "tracker_last_utm_source", label: "마지막 유입", fieldType: "text", isSortable: 1, isGroupable: 1 },
    { key: "tracker_last_utm_campaign", label: "마지막 캠페인", fieldType: "text", isSortable: 1 },

    // 마지막 활동
    { key: "tracker_last_page", label: "마지막 페이지", fieldType: "text", isSortable: 0 },
    { key: "tracker_last_event", label: "마지막 이벤트", fieldType: "text", isSortable: 1 },
    { key: "tracker_last_event_at", label: "마지막 이벤트 시각", fieldType: "datetime", isSortable: 1 },
];

export const TRACKER_FIELD_TYPE_NAME_PREFIX = "[트래커] ";
