import type { BotReason } from "@/lib/email-click-bot-rules";
import {
    pgTable,
    serial,
    uuid,
    varchar,
    text,
    integer,
    smallint,
    bigint,
    boolean,
    timestamp,
    unique,
    jsonb,
    index,
    uniqueIndex,
    numeric,
    primaryKey,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import type { FormulaConfig } from "@/types";
export * from "./ai-copy-schema";
export * from "./email-experiment-schema";
export * from "./copy-automation-schema";
export * from "./inbox-schema";
export * from "./customer-platform-schema";
export * from "./customer-sales-schema";
export * from "./customer-activity-schema";
export * from "./inbox-files-schema";
export * from "./platform-webhook-schema";
export * from "./customer-ai-schema";
export * from "./customer-workflow-schema";

// timestamptz 헬퍼
const timestamptz = (name: string) => timestamp(name, { withTimezone: true });

// ============================================
// 조직 (테넌트)
// ============================================
export const organizations = pgTable("organizations", {
    id: uuid("id").defaultRandom().primaryKey(),
    name: varchar("name", { length: 200 }).notNull(),
    slug: varchar("slug", { length: 100 }).unique().notNull(),
    branding: jsonb("branding").$type<{
        logo?: string;
        primaryColor?: string;
        companyName?: string;
    }>(),
    integratedCodePrefix: varchar("integrated_code_prefix", { length: 20 }).default("SALES").notNull(),
    integratedCodeSeq: integer("integrated_code_seq").default(0).notNull(),
    settings: jsonb("settings").$type<{
        timezone?: string;
        locale?: string;
        dateFormat?: string;
        industry?: string;
        companySize?: string;
    }>(),
    onboardingCompleted: boolean("onboarding_completed").default(false).notNull(),
    createdAt: timestamptz("created_at").defaultNow().notNull(),
    updatedAt: timestamptz("updated_at").defaultNow().notNull(),
});

// ============================================
// 사용자
// ============================================
export const users = pgTable(
    "users",
    {
        id: uuid("id").defaultRandom().primaryKey(),
        orgId: uuid("org_id")
            .references(() => organizations.id, { onDelete: "cascade" }),
        email: varchar("email", { length: 255 }).notNull(),
        password: varchar("password", { length: 255 }).notNull(),
        name: varchar("name", { length: 100 }).notNull(),
        role: varchar("role", { length: 20 }).default("member").notNull(), // owner | admin | member
        phone: varchar("phone", { length: 20 }),
        isActive: integer("is_active").default(1).notNull(),
        isSuperAdmin: integer("is_super_admin").default(0).notNull(),
        createdAt: timestamptz("created_at").defaultNow().notNull(),
        updatedAt: timestamptz("updated_at").defaultNow().notNull(),
    },
    (table) => ({
        orgEmailUnique: unique().on(table.orgId, table.email),
    })
);

// ============================================
// 속성 타입 (Field Types)
// ============================================
export const fieldTypes = pgTable("field_types", {
    id: serial("id").primaryKey(),
    orgId: uuid("org_id")
        .references(() => organizations.id, { onDelete: "cascade" })
        .notNull(),
    name: varchar("name", { length: 100 }).notNull(),
    description: text("description"),
    icon: varchar("icon", { length: 50 }),
    createdAt: timestamptz("created_at").defaultNow().notNull(),
    updatedAt: timestamptz("updated_at").defaultNow().notNull(),
}, (table) => ({
    orgNameUnique: unique().on(table.orgId, table.name),
}));

// ============================================
// 워크스페이스
// ============================================
export const workspaces = pgTable("workspaces", {
    id: serial("id").primaryKey(),
    orgId: uuid("org_id")
        .references(() => organizations.id, { onDelete: "cascade" })
        .notNull(),
    name: varchar("name", { length: 200 }).notNull(),
    description: text("description"),
    icon: varchar("icon", { length: 50 }),
    codePrefix: varchar("code_prefix", { length: 20 }),
    defaultFieldTypeId: integer("default_field_type_id"),
    settings: jsonb("settings").$type<{
        defaultVisibleFields?: string[];
        duplicateCheckField?: string;
    }>(),
    // 답장 받을 주소 (DESIGN-3, 마이그레이션 0073). 발송에 쓰지 않는다 — NHN이 Reply-To 사용자 지정 헤더를 거절해(2026-10-04)
    // 발송 경로·설정 화면에서 뺐다. 칸은 남겨 둔다 (지우는 마이그레이션 없음). 답장은 보낸 주소로 간다
    replyToEmail: varchar("reply_to_email", { length: 200 }),
    createdAt: timestamptz("created_at").defaultNow().notNull(),
    updatedAt: timestamptz("updated_at").defaultNow().notNull(),
});

// ============================================
// 필드 정의 (속성 타입별 커스텀 필드)
// ============================================
export const fieldDefinitions = pgTable(
    "field_definitions",
    {
        id: serial("id").primaryKey(),
        workspaceId: integer("workspace_id")
            .references(() => workspaces.id, { onDelete: "cascade" }),
        fieldTypeId: integer("field_type_id")
            .references(() => fieldTypes.id, { onDelete: "cascade" }),
        key: varchar("key", { length: 100 }).notNull(),
        label: varchar("label", { length: 200 }).notNull(),
        fieldType: varchar("field_type", { length: 30 }).notNull(), // text|number|date|select|phone|...
        category: varchar("category", { length: 100 }),
        sortOrder: integer("sort_order").default(0).notNull(),
        isRequired: integer("is_required").default(0).notNull(),
        isSystem: integer("is_system").default(0).notNull(),
        isSortable: integer("is_sortable").default(0).notNull(),
        // 표시 설정
        defaultWidth: integer("default_width").default(120).notNull(),
        minWidth: integer("min_width").default(80).notNull(),
        cellType: varchar("cell_type", { length: 30 }),
        cellClassName: varchar("cell_class_name", { length: 100 }),
        // Select/Status 옵션
        options: jsonb("options").$type<string[]>(),
        optionColors: jsonb("option_colors").$type<Record<string, string>>(),
        optionStyle: varchar("option_style", { length: 10 }), // "pill" | "square"
        isGroupable: integer("is_groupable").default(0).notNull(),
        statusOptionCategoryId: integer("status_option_category_id"),
        // 기본값 (레코드 생성 시 자동 적용)
        defaultValue: varchar("default_value", { length: 500 }),
        // 수식 설정
        formulaConfig: jsonb("formula_config").$type<FormulaConfig>(),
        // 시스템 컬럼 매핑 (NULL=커스텀, 'registeredAt'|'createdAt'|'updatedAt'=시스템)
        systemColumn: varchar("system_column", { length: 50 }),
        // 변경 이력 추적 (1이면 값 변경 시 record_events에 기록)
        trackHistory: integer("track_history").default(0).notNull(),
        createdAt: timestamptz("created_at").defaultNow().notNull(),
        updatedAt: timestamptz("updated_at").defaultNow().notNull(),
    },
    (table) => ({
        workspaceKeyUnique: unique().on(table.workspaceId, table.key),
    })
);

// ============================================
// 폴더
// ============================================
export const folders = pgTable("folders", {
    id: serial("id").primaryKey(),
    workspaceId: integer("workspace_id")
        .references(() => workspaces.id, { onDelete: "cascade" })
        .notNull(),
    name: varchar("name", { length: 100 }).notNull(),
    displayOrder: integer("display_order").default(0).notNull(),
    createdAt: timestamptz("created_at").defaultNow().notNull(),
    updatedAt: timestamptz("updated_at").defaultNow().notNull(),
});

// ============================================
// 파티션
// ============================================
export const partitions = pgTable("partitions", {
    id: serial("id").primaryKey(),
    workspaceId: integer("workspace_id")
        .references(() => workspaces.id, { onDelete: "cascade" })
        .notNull(),
    name: varchar("name", { length: 100 }).notNull(),
    folderId: integer("folder_id"),
    fieldTypeId: integer("field_type_id"),
    displayOrder: integer("display_order").default(0).notNull(),
    visibleFields: jsonb("visible_fields").$type<string[]>(),
    // 분배순서 설정
    useDistributionOrder: integer("use_distribution_order").default(0).notNull(),
    maxDistributionOrder: integer("max_distribution_order").default(5).notNull(),
    lastAssignedOrder: integer("last_assigned_order").default(0).notNull(),
    distributionDefaults: jsonb("distribution_defaults").$type<
        Record<number, { field: string; value: string }[]>
    >(),
    // 중복 체크
    duplicateCheckField: varchar("duplicate_check_field", { length: 100 }),
    duplicateConfig: jsonb("duplicate_config").$type<{
        field: string;
        action: "reject" | "allow" | "merge" | "delete_old";
        highlightEnabled: boolean;
        highlightColor: string;
    } | null>(),
    // 상태 옵션 필터
    statusOptionIds: jsonb("status_option_ids").$type<number[]>(),
    // 예약 등록 설정 (매일 지정 시각에 N개씩 자동 등록)
    scheduledRegistrationConfig: jsonb("scheduled_registration_config").$type<{
        enabled: boolean;
        timeOfDay: string; // "HH:mm" (KST)
        countPerDay: number;
        lastRunDate?: string; // "YYYY-MM-DD" — 하루 1회 실행 보장
    } | null>(),
    createdAt: timestamptz("created_at").defaultNow().notNull(),
    updatedAt: timestamptz("updated_at").defaultNow().notNull(),
});

// ============================================
// 예약 등록 대기열 (업로드 → 매일 N개씩 레코드 등록)
// ============================================
export const scheduledRegistrations = pgTable(
    "scheduled_registrations",
    {
        id: serial("id").primaryKey(),
        orgId: uuid("org_id")
            .references(() => organizations.id, { onDelete: "cascade" })
            .notNull(),
        workspaceId: integer("workspace_id")
            .references(() => workspaces.id, { onDelete: "cascade" })
            .notNull(),
        partitionId: integer("partition_id")
            .references(() => partitions.id, { onDelete: "cascade" })
            .notNull(),
        data: jsonb("data").$type<Record<string, unknown>>().notNull(),
        status: varchar("status", { length: 20 }).default("pending").notNull(), // pending | registered | failed
        recordId: integer("record_id"),
        sourceFileName: varchar("source_file_name", { length: 300 }),
        errorMessage: text("error_message"),
        createdAt: timestamptz("created_at").defaultNow().notNull(),
        registeredAt: timestamptz("registered_at"),
    },
    (table) => [
        // 일일 픽업(status='pending' ORDER BY id) + 목록/카운트 동시 커버
        index("scheduled_registrations_pickup_idx").on(
            table.partitionId,
            table.status,
            table.id,
        ),
    ],
);

export type ScheduledRegistration = typeof scheduledRegistrations.$inferSelect;
export type NewScheduledRegistration = typeof scheduledRegistrations.$inferInsert;

// ============================================
// 레코드 (JSONB 기반 유연한 데이터)
// ============================================
export const records = pgTable(
    "records",
    {
        id: serial("id").primaryKey(),
        orgId: uuid("org_id").notNull(),
        workspaceId: integer("workspace_id").notNull(),
        partitionId: integer("partition_id")
            .references(() => partitions.id, { onDelete: "cascade" })
            .notNull(),
        integratedCode: varchar("integrated_code", { length: 50 }),
        distributionOrder: integer("distribution_order"),
        data: jsonb("data").$type<Record<string, unknown>>().default({}).notNull(),
        registeredAt: timestamptz("registered_at").defaultNow().notNull(),
        createdAt: timestamptz("created_at").defaultNow().notNull(),
        updatedAt: timestamptz("updated_at").defaultNow().notNull(),
    },
    (table) => ({
        orgIdx: index("records_org_idx").on(table.orgId),
        partitionIdx: index("records_partition_idx").on(table.partitionId),
        workspaceIdx: index("records_workspace_idx").on(table.workspaceId),
    })
);

// ============================================
// 메모
// ============================================
export const memos = pgTable("memos", {
    id: serial("id").primaryKey(),
    recordId: integer("record_id")
        .references(() => records.id, { onDelete: "cascade" })
        .notNull(),
    content: text("content").notNull(),
    createdBy: uuid("created_by").references(() => users.id),
    createdAt: timestamptz("created_at").defaultNow().notNull(),
});

// ============================================
// 권한
// ============================================
export const workspacePermissions = pgTable(
    "workspace_permissions",
    {
        id: serial("id").primaryKey(),
        workspaceId: integer("workspace_id")
            .references(() => workspaces.id, { onDelete: "cascade" })
            .notNull(),
        userId: uuid("user_id")
            .references(() => users.id, { onDelete: "cascade" })
            .notNull(),
        permissionType: varchar("permission_type", { length: 20 }).notNull(),
        grantedBy: uuid("granted_by").references(() => users.id),
        createdAt: timestamptz("created_at").defaultNow().notNull(),
    },
    (table) => ({
        workspaceUserUnique: unique().on(table.workspaceId, table.userId),
    })
);

export const partitionPermissions = pgTable(
    "partition_permissions",
    {
        id: serial("id").primaryKey(),
        partitionId: integer("partition_id")
            .references(() => partitions.id, { onDelete: "cascade" })
            .notNull(),
        userId: uuid("user_id")
            .references(() => users.id, { onDelete: "cascade" })
            .notNull(),
        permissionType: varchar("permission_type", { length: 20 }).notNull(),
        grantedBy: uuid("granted_by").references(() => users.id),
        createdAt: timestamptz("created_at").defaultNow().notNull(),
    },
    (table) => ({
        partitionUserUnique: unique().on(table.partitionId, table.userId),
    })
);

// ============================================
// 멤버 파티션 권한 범위 (member 역할 대상, allow 기본)
// ============================================
export const memberScopes = pgTable(
    "member_scopes",
    {
        id: serial("id").primaryKey(),
        orgId: uuid("org_id")
            .references(() => organizations.id, { onDelete: "cascade" })
            .notNull(),
        userId: uuid("user_id")
            .references(() => users.id, { onDelete: "cascade" })
            .notNull(),
        // "org" | "workspace" | "folder" | "partition" — scopeId는 org일 때 0
        scopeType: varchar("scope_type", { length: 20 }).notNull(),
        scopeId: integer("scope_id").notNull(),
        permissions: jsonb("permissions")
            .$type<{ read: boolean; create: boolean; update: boolean; delete: boolean }>()
            .notNull(),
        grantedBy: uuid("granted_by").references(() => users.id, { onDelete: "set null" }),
        createdAt: timestamptz("created_at").defaultNow().notNull(),
        updatedAt: timestamptz("updated_at").defaultNow().notNull(),
    },
    (table) => ({
        orgIdx: index("member_scopes_org_idx").on(table.orgId),
        scopeUnique: unique().on(table.orgId, table.userId, table.scopeType, table.scopeId),
    })
);

// ============================================
// 상태 옵션
// ============================================
export const statusOptionCategories = pgTable(
    "status_option_categories",
    {
        id: serial("id").primaryKey(),
        workspaceId: integer("workspace_id")
            .references(() => workspaces.id, { onDelete: "cascade" })
            .notNull(),
        key: varchar("key", { length: 50 }).notNull(),
        label: varchar("label", { length: 100 }).notNull(),
        sortOrder: integer("sort_order").default(0).notNull(),
        createdAt: timestamptz("created_at").defaultNow().notNull(),
    },
    (table) => ({
        workspaceKeyUnique: unique().on(table.workspaceId, table.key),
    })
);

export const statusOptions = pgTable(
    "status_options",
    {
        id: serial("id").primaryKey(),
        categoryId: integer("category_id")
            .references(() => statusOptionCategories.id, { onDelete: "cascade" })
            .notNull(),
        value: varchar("value", { length: 100 }).notNull(),
        label: varchar("label", { length: 100 }).notNull(),
        bgColor: varchar("bg_color", { length: 30 }),
        sortOrder: integer("sort_order").default(0).notNull(),
        isActive: integer("is_active").default(1).notNull(),
        createdAt: timestamptz("created_at").defaultNow().notNull(),
        updatedAt: timestamptz("updated_at").defaultNow().notNull(),
    },
    (table) => ({
        categoryValueUnique: unique().on(table.categoryId, table.value),
    })
);

// ============================================
// API 토큰
// ============================================
export const apiTokens = pgTable("api_tokens", {
    id: serial("id").primaryKey(),
    orgId: uuid("org_id")
        .references(() => organizations.id, { onDelete: "cascade" })
        .notNull(),
    name: varchar("name", { length: 100 }).notNull(),
    token: varchar("token", { length: 64 }).unique().notNull(),
    createdBy: uuid("created_by")
        .references(() => users.id)
        .notNull(),
    lastUsedAt: timestamptz("last_used_at"),
    expiresAt: timestamptz("expires_at"),
    isActive: integer("is_active").default(1).notNull(),
    createdAt: timestamptz("created_at").defaultNow().notNull(),
});

// ============================================
// API 토큰 권한 범위
// ============================================
export const apiTokenScopes = pgTable("api_token_scopes", {
    id: serial("id").primaryKey(),
    tokenId: integer("token_id")
        .references(() => apiTokens.id, { onDelete: "cascade" })
        .notNull(),
    scopeType: varchar("scope_type", { length: 20 }).notNull(), // "workspace" | "folder" | "partition"
    scopeId: integer("scope_id").notNull(),
    permissions: jsonb("permissions")
        .$type<{ read: boolean; create: boolean; update: boolean; delete: boolean }>()
        .notNull(),
});

export type ApiTokenScope = typeof apiTokenScopes.$inferSelect;

// ============================================
// 알림톡 설정 (조직별)
// ============================================
export const alimtalkConfigs = pgTable("alimtalk_configs", {
    id: serial("id").primaryKey(),
    orgId: uuid("org_id")
        .references(() => organizations.id, { onDelete: "cascade" })
        .unique()
        .notNull(),
    appKey: varchar("app_key", { length: 200 }).notNull(),
    secretKey: varchar("secret_key", { length: 200 }).notNull(),
    defaultSenderKey: varchar("default_sender_key", { length: 200 }),
    isActive: integer("is_active").default(1).notNull(),
    createdAt: timestamptz("created_at").defaultNow().notNull(),
    updatedAt: timestamptz("updated_at").defaultNow().notNull(),
});

// ============================================
// 알림톡 템플릿 연결
// ============================================
export const alimtalkTemplateLinks = pgTable("alimtalk_template_links", {
    id: serial("id").primaryKey(),
    partitionId: integer("partition_id")
        .references(() => partitions.id, { onDelete: "cascade" })
        .notNull(),
    name: varchar("name", { length: 100 }).notNull(),
    senderKey: varchar("sender_key", { length: 100 }).notNull(),
    templateCode: varchar("template_code", { length: 100 }).notNull(),
    templateName: varchar("template_name", { length: 200 }),
    triggerType: varchar("trigger_type", { length: 30 }).default("manual").notNull(),
    triggerCondition: jsonb("trigger_condition").$type<{
        field?: string;
        operator?: "eq" | "ne" | "contains";
        value?: string;
    }>(),
    repeatConfig: jsonb("repeat_config").$type<{
        intervalHours: number;
        maxRepeat: number;
        stopCondition: {
            field: string;
            operator: "eq" | "ne";
            value: string;
        };
    } | null>(),
    recipientField: varchar("recipient_field", { length: 100 }).notNull(),
    variableMappings: jsonb("variable_mappings").$type<Record<string, string>>(),
    followupConfig: jsonb("followup_config").$type<
        | Array<{
              delayDays?: number;
              delayHours?: number;
              delayMinutes?: number;
              templateCode: string;
              templateName?: string;
              variableMappings?: Record<string, string>;
          }>
        | {
              delayDays?: number;
              delayHours?: number;
              delayMinutes?: number;
              templateCode: string;
              templateName?: string;
              variableMappings?: Record<string, string>;
          }
        | null
    >(),
    preventDuplicate: integer("prevent_duplicate").default(0).notNull(),
    isActive: integer("is_active").default(1).notNull(),
    createdBy: uuid("created_by").references(() => users.id),
    createdAt: timestamptz("created_at").defaultNow().notNull(),
    updatedAt: timestamptz("updated_at").defaultNow().notNull(),
});

// ============================================
// 알림톡 후속발송 큐
// ============================================
export const alimtalkFollowupQueue = pgTable(
    "alimtalk_followup_queue",
    {
        id: serial("id").primaryKey(),
        parentLogId: integer("parent_log_id")
            .references(() => alimtalkSendLogs.id, { onDelete: "cascade" })
            .notNull(),
        templateLinkId: integer("template_link_id")
            .references(() => alimtalkTemplateLinks.id, { onDelete: "cascade" })
            .notNull(),
        orgId: uuid("org_id").notNull(),
        sendAt: timestamptz("send_at").notNull(),
        status: varchar("status", { length: 20 }).default("pending").notNull(),
        // 후속발송 단계 인덱스 (0부터)
        stepIndex: integer("step_index").default(0).notNull(),
        processedAt: timestamptz("processed_at"),
        createdAt: timestamptz("created_at").defaultNow().notNull(),
    },
    (table) => ({
        // 같은 parent_log + step 조합 중복 방지 (체인 등록 멱등성)
        parentLogStepIdx: uniqueIndex("alfq_parent_log_step_idx").on(
            table.parentLogId,
            table.stepIndex
        ),
    })
);

// ============================================
// 알림톡 템플릿 임시저장
// ============================================
export const alimtalkTemplateDrafts = pgTable("alimtalk_template_drafts", {
    id: serial("id").primaryKey(),
    orgId: uuid("org_id")
        .references(() => organizations.id, { onDelete: "cascade" })
        .notNull(),
    senderKey: varchar("sender_key", { length: 200 }).notNull(),
    templateCode: varchar("template_code", { length: 100 }).notNull(),
    templateName: varchar("template_name", { length: 200 }).notNull(),
    formData: jsonb("form_data").$type<Record<string, unknown>>().notNull(),
    createdAt: timestamptz("created_at").defaultNow().notNull(),
    updatedAt: timestamptz("updated_at").defaultNow().notNull(),
});

export type AlimtalkTemplateDraft = typeof alimtalkTemplateDrafts.$inferSelect;

// ============================================
// 알림톡 발송 로그
// ============================================
export const alimtalkSendLogs = pgTable("alimtalk_send_logs", {
    id: serial("id").primaryKey(),
    orgId: uuid("org_id").notNull(),
    templateLinkId: integer("template_link_id").references(
        () => alimtalkTemplateLinks.id,
        { onDelete: "set null" }
    ),
    partitionId: integer("partition_id"),
    recordId: integer("record_id"),
    senderKey: varchar("sender_key", { length: 100 }).notNull(),
    templateCode: varchar("template_code", { length: 100 }).notNull(),
    templateName: varchar("template_name", { length: 200 }),
    recipientNo: varchar("recipient_no", { length: 20 }).notNull(),
    requestId: varchar("request_id", { length: 100 }),
    recipientSeq: integer("recipient_seq"),
    status: varchar("status", { length: 20 }).default("pending").notNull(),
    resultCode: varchar("result_code", { length: 20 }),
    resultMessage: text("result_message"),
    content: text("content"),
    triggerType: varchar("trigger_type", { length: 30 }),
    // 후속발송 단계: auto/repeat=0, followup step N = N+1 (1번째 후속이 1)
    stepIndex: integer("step_index").default(0).notNull(),
    sentBy: uuid("sent_by").references(() => users.id),
    sentAt: timestamptz("sent_at").defaultNow().notNull(),
    completedAt: timestamptz("completed_at"),
});

// ============================================
// 알림톡 자동 발송 큐
// ============================================
export const alimtalkAutomationQueue = pgTable(
    "alimtalk_automation_queue",
    {
        id: serial("id").primaryKey(),
        templateLinkId: integer("template_link_id")
            .references(() => alimtalkTemplateLinks.id, { onDelete: "cascade" })
            .notNull(),
        recordId: integer("record_id")
            .references(() => records.id, { onDelete: "cascade" })
            .notNull(),
        orgId: uuid("org_id").notNull(),
        repeatCount: integer("repeat_count").default(0).notNull(),
        nextRunAt: timestamptz("next_run_at").notNull(),
        status: varchar("status", { length: 20 }).default("pending").notNull(),
        createdAt: timestamptz("created_at").defaultNow().notNull(),
        updatedAt: timestamptz("updated_at").defaultNow().notNull(),
    },
    (table) => ({
        statusNextRunIdx: index("aq_status_next_run_idx").on(table.status, table.nextRunAt),
        templateRecordIdx: index("aq_template_record_idx").on(table.templateLinkId, table.recordId),
    })
);

// ============================================
// 이메일 설정 (조직별)
// ============================================
export const emailConfigs = pgTable("email_configs", {
    id: serial("id").primaryKey(),
    orgId: uuid("org_id")
        .references(() => organizations.id, { onDelete: "cascade" })
        .unique()
        .notNull(),
    appKey: varchar("app_key", { length: 200 }).notNull(),
    secretKey: varchar("secret_key", { length: 200 }).notNull(),
    fromName: varchar("from_name", { length: 100 }),
    fromEmail: varchar("from_email", { length: 200 }),
    signature: text("signature"),
    signatureEnabled: boolean("signature_enabled").default(false).notNull(),
    isActive: integer("is_active").default(1).notNull(),
    createdAt: timestamptz("created_at").defaultNow().notNull(),
    updatedAt: timestamptz("updated_at").defaultNow().notNull(),
});

// ============================================
// 이메일 템플릿
// ============================================
export const emailTemplates = pgTable("email_templates", {
    id: serial("id").primaryKey(),
    orgId: uuid("org_id")
        .references(() => organizations.id, { onDelete: "cascade" })
        .notNull(),
    name: varchar("name", { length: 200 }).notNull(),
    subject: varchar("subject", { length: 500 }).notNull(),
    htmlBody: text("html_body").notNull(),
    templateType: varchar("template_type", { length: 50 }),
    categoryId: integer("category_id"),
    status: varchar("status", { length: 20 }).default("published").notNull(),
    isActive: integer("is_active").default(1).notNull(),
    useUnsubscribe: integer("use_unsubscribe").default(0).notNull(),  // 본문 하단에 수신거부 링크 삽입
    createdAt: timestamptz("created_at").defaultNow().notNull(),
    updatedAt: timestamptz("updated_at").defaultNow().notNull(),
});

// ============================================
// 이메일 템플릿 연결
// ============================================
export const emailTemplateLinks = pgTable("email_template_links", {
    id: serial("id").primaryKey(),
    partitionId: integer("partition_id")
        .references(() => partitions.id, { onDelete: "cascade" })
        .notNull(),
    name: varchar("name", { length: 100 }).notNull(),
    emailTemplateId: integer("email_template_id")
        .references(() => emailTemplates.id, { onDelete: "cascade" })
        .notNull(),
    recipientField: varchar("recipient_field", { length: 100 }).notNull(),
    variableMappings: jsonb("variable_mappings").$type<Record<string, string>>(),
    triggerType: varchar("trigger_type", { length: 30 }).default("manual").notNull(),
    triggerCondition: jsonb("trigger_condition").$type<{
        field?: string;
        operator?: "eq" | "ne" | "contains";
        value?: string;
    }>(),
    repeatConfig: jsonb("repeat_config").$type<{
        intervalHours: number;
        maxRepeat: number;
        stopCondition: {
            field: string;
            operator: "eq" | "ne";
            value: string;
        };
    } | null>(),
    followupConfig: jsonb("followup_config").$type<{
        delayDays: number;
        onClicked?: { templateId: number };
        onNotClicked?: { templateId: number };
    } | null>(),
    preventDuplicate: integer("prevent_duplicate").default(0).notNull(),
    isActive: integer("is_active").default(1).notNull(),
    createdBy: uuid("created_by").references(() => users.id),
    createdAt: timestamptz("created_at").defaultNow().notNull(),
    updatedAt: timestamptz("updated_at").defaultNow().notNull(),
});

// ============================================
// 이메일 발송 로그
// ============================================
export const emailSendLogs = pgTable("email_send_logs", {
    id: serial("id").primaryKey(),
    orgId: uuid("org_id").notNull(),
    templateLinkId: integer("template_link_id").references(
        () => emailTemplateLinks.id,
        { onDelete: "set null" }
    ),
    partitionId: integer("partition_id"),
    recordId: integer("record_id"),
    emailTemplateId: integer("email_template_id"),
    recipientEmail: varchar("recipient_email", { length: 200 }).notNull(),
    subject: varchar("subject", { length: 500 }),
    body: text("body"),
    requestId: varchar("request_id", { length: 100 }),
    status: varchar("status", { length: 20 }).default("pending").notNull(),
    resultCode: varchar("result_code", { length: 20 }),
    resultMessage: text("result_message"),
    triggerType: varchar("trigger_type", { length: 30 }),
    sentBy: uuid("sent_by").references(() => users.id),
    sentAt: timestamptz("sent_at").defaultNow().notNull(),
    completedAt: timestamptz("completed_at"),
    parentLogId: integer("parent_log_id"),
    autoPersonalizedLinkId: integer("auto_personalized_link_id").references(
        () => emailAutoPersonalizedLinks.id,
        { onDelete: "set null" }
    ),
    unsubscribeToken: varchar("unsubscribe_token", { length: 64 }),  // 본문 수신거부 링크가 발송 건을 되짚는 토큰
    senderProfileId: integer("sender_profile_id"),  // 후속 메일이 원본 발신자를 상속하기 위한 값. 마이그레이션 이전 로그는 null
    // 보낼 때 실제로 쓴 발신 주소 (DESIGN-3 4-1). 프로필 주소를 나중에 바꿔도 그대로다. 0073 전 로그는 null
    senderEmail: varchar("sender_email", { length: 200 }),
    // ── 발송 결과 자동 맞추기 (0075, DESIGN-SND 3절·4절). 이 칸을 쓰는 곳은 applyNhnStatuses·recordBounceSignal 둘뿐이다
    /** NHN 상태 코드 그대로 (SST0~SST8). NULL = 아직 NHN 결과를 받지 못함 */
    nhnStatusCode: varchar("nhn_status_code", { length: 8 }),
    nhnCheckedAt: timestamptz("nhn_checked_at"),
    /** 3-3 보조 질문(요청 번호 조회) 횟수 — 3번까지 */
    nhnCheckCount: smallint("nhn_check_count").default(0).notNull(),
    /** 'nhn' = SST3, 'dsn' = 회신 메일함에 온 반송 안내. 먼저 온 쪽이 남는다 (한 기록에 실패는 한 번) */
    deliveryFailSource: varchar("delivery_fail_source", { length: 8 }),
    deliveryFailedAt: timestamptz("delivery_failed_at"),
    /** 5.1.1 같은 상태 (NHN dsnCode 또는 반송 안내 Status) */
    deliveryStatusCode: varchar("delivery_status_code", { length: 16 }),
    /** recipient | sender (SST7·8, 5.7.x·SPF·DKIM·DMARC) */
    deliveryFailSide: varchar("delivery_fail_side", { length: 10 }),
}, (table) => [
    // 마이그레이션에는 없다 — 부팅 뒤 트랜잭션 밖에서 CONCURRENTLY로 만든다 (src/lib/db/send-log-indexes.ts, DESIGN-SND 8-3).
    // 이 저장소는 db:generate를 쓰지 않으므로 이 선언이 마이그레이션을 만들지 않는다. 이름은 send-log-indexes.ts와 같다
    index("email_send_logs_org_sent_at_idx").on(table.orgId, table.sentAt),
    index("email_send_logs_request_id_idx").on(table.requestId).where(sql`request_id IS NOT NULL`),
]);

// ============================================
// 이메일 클릭 추적
// ============================================
export const emailClickLogs = pgTable("email_click_logs", {
    id: serial("id").primaryKey(),
    orgId: uuid("org_id").notNull(),
    sendLogId: integer("send_log_id")
        .references(() => emailSendLogs.id, { onDelete: "cascade" })
        .notNull(),
    url: text("url").notNull(),
    clickedAt: timestamptz("clicked_at").defaultNow().notNull(),
    ip: varchar("ip", { length: 50 }),
    userAgent: text("user_agent"),
    clickId: varchar("click_id", { length: 64 }),  // 트래커 매칭용 토큰 (sendb_cid)
    isBot: boolean("is_bot").default(false).notNull(),
    botReason: varchar("bot_reason", { length: 16 }).$type<BotReason>(),
}, (table) => [
    index("email_click_logs_send_log_idx").on(table.sendLogId),
    uniqueIndex("email_click_logs_click_id_idx").on(table.clickId),
]);

export type EmailClickLog = typeof emailClickLogs.$inferSelect;

// ============================================
// 이메일 수신거부
// ============================================
// 거부 범위는 워크스페이스 단위. 등록되면 해당 워크스페이스의 모든 발송 경로
// (수동/자동/AI/후속)에서 제외된다.
export const emailUnsubscribes = pgTable("email_unsubscribes", {
    id: serial("id").primaryKey(),
    orgId: uuid("org_id")
        .references(() => organizations.id, { onDelete: "cascade" })
        .notNull(),
    workspaceId: integer("workspace_id")
        .references(() => workspaces.id, { onDelete: "cascade" })
        .notNull(),
    email: varchar("email", { length: 200 }).notNull(),
    sendLogId: integer("send_log_id").references(() => emailSendLogs.id, {
        onDelete: "set null",
    }),
    recordId: integer("record_id"),
    source: varchar("source", { length: 20 }).default("link").notNull(),  // link | one_click | manual
    reason: text("reason"),
    unsubscribedAt: timestamptz("unsubscribed_at").defaultNow().notNull(),
});

export type EmailUnsubscribe = typeof emailUnsubscribes.$inferSelect;

// ============================================
// 이메일 자동 발송 큐
// ============================================
export const emailAutomationQueue = pgTable(
    "email_automation_queue",
    {
        id: serial("id").primaryKey(),
        templateLinkId: integer("template_link_id")
            .references(() => emailTemplateLinks.id, { onDelete: "cascade" })
            .notNull(),
        recordId: integer("record_id")
            .references(() => records.id, { onDelete: "cascade" })
            .notNull(),
        orgId: uuid("org_id").notNull(),
        repeatCount: integer("repeat_count").default(0).notNull(),
        nextRunAt: timestamptz("next_run_at").notNull(),
        status: varchar("status", { length: 20 }).default("pending").notNull(), // pending | completed | cancelled | held(명단 보류, DESIGN-SND 6-2)
        // repeat = 반복 발송, first = 발신 한도로 미룬 템플릿 자동 첫 메일(문의),
        // first_bulk = 가져오기·예약 등록 명단의 미룬 첫 메일(대량 — 15:00 KST 전까지 문의 몫을 남긴다, DESIGN-2 2절)
        kind: varchar("kind", { length: 10 }).default("repeat").notNull(),
        // 멈춘 까닭 (0074, DESIGN-RPL 7-2·7-4): replied(회신) | bounced(반송). 사람이 고른 취소·규칙 꺼짐은 NULL
        stopReason: varchar("stop_reason", { length: 30 }),
        createdAt: timestamptz("created_at").defaultNow().notNull(),
        updatedAt: timestamptz("updated_at").defaultNow().notNull(),
    },
    (table) => ({
        statusNextRunIdx: index("eq_status_next_run_idx").on(table.status, table.nextRunAt),
        templateRecordIdx: index("eq_template_record_idx").on(table.templateLinkId, table.recordId),
    })
);

// ============================================
// AI 개인화 이메일 자동 발송 규칙
// ============================================
export const emailAutoPersonalizedLinks = pgTable("email_auto_personalized_links", {
    id: serial("id").primaryKey(),
    orgId: uuid("org_id")
        .references(() => organizations.id, { onDelete: "cascade" })
        .notNull(),
    name: varchar("name", { length: 100 }),
    partitionId: integer("partition_id")
        .references(() => partitions.id, { onDelete: "cascade" })
        .notNull(),
    productId: integer("product_id"),
    recipientField: varchar("recipient_field", { length: 100 }).notNull(),
    companyField: varchar("company_field", { length: 100 }).notNull(),
    ctaUrl: varchar("cta_url", { length: 500 }),
    prompt: text("prompt"),
    tone: varchar("tone", { length: 50 }),
    model: varchar("model", { length: 100 }),  // 첫 메일 + 팔로우업 공유 AI 모델. null이면 기본 모델.
    format: varchar("format", { length: 20 }).default("plain").notNull(),
    triggerType: varchar("trigger_type", { length: 20 }).default("on_create").notNull(),
    triggerCondition: jsonb("trigger_condition").$type<{
        field?: string;
        operator?: "eq" | "ne" | "contains";
        value?: string;
    }>(),
    autoResearch: integer("auto_research").default(1).notNull(),
    useSignaturePersona: integer("use_signature_persona").default(0).notNull(),
    useUnsubscribe: integer("use_unsubscribe").default(0).notNull(),  // 본문 하단에 수신거부 링크 삽입
    followupConfig: jsonb("followup_config").$type<{
        delayDays: number;
        onClicked?: { prompt: string };
        onNotClicked?: { prompt: string };
    } | null>(),
    // 발신 주소 묶음의 첫 주소. 묶음을 모르는 예전 경로가 읽을 수 있게 senderProfileIds[0]으로 맞춰 둔다
    senderProfileId: integer("sender_profile_id"),
    // 발신 주소 묶음 (순서 있음). null이면 senderProfileId 하나, 그것도 없으면 기본 발신 주소
    senderProfileIds: jsonb("sender_profile_ids").$type<number[]>(),
    signatureId: integer("signature_id"),
    preventDuplicate: integer("prevent_duplicate").default(0).notNull(),
    // 규칙에 연결된 이메일 에셋 id 목록. null/[]이면 이미지 없음.
    assetIds: jsonb("asset_ids").$type<number[]>(),
    isActive: integer("is_active").default(1).notNull(),
    isDraft: integer("is_draft").default(0).notNull(),
    createdAt: timestamptz("created_at").defaultNow().notNull(),
    updatedAt: timestamptz("updated_at").defaultNow().notNull(),
});

// ============================================
// 이메일 에셋 (HTML 본문 이미지) — org(조직) 단위 공유·재사용
// ============================================
export const emailAssets = pgTable(
    "email_assets",
    {
        id: serial("id").primaryKey(),
        orgId: uuid("org_id")
            .references(() => organizations.id, { onDelete: "cascade" })
            .notNull(),
        name: varchar("name", { length: 200 }).notNull(), // 표시 이름(초기값=파일명)
        url: varchar("url", { length: 500 }).notNull(), // R2 공개 URL
        r2Key: varchar("r2_key", { length: 300 }).notNull(), // email/{orgId}/{random}.{ext}
        contentType: varchar("content_type", { length: 50 }).notNull(),
        size: integer("size").notNull(), // bytes
        createdAt: timestamptz("created_at").defaultNow().notNull(),
    },
    (table) => [index("email_assets_org_idx").on(table.orgId)]
);

// ============================================
// 이메일 후속 발송 큐
// ============================================
export const emailFollowupQueue = pgTable(
    "email_followup_queue",
    {
        id: serial("id").primaryKey(),
        parentLogId: integer("parent_log_id")
            .references(() => emailSendLogs.id, { onDelete: "cascade" })
            .notNull(),
        sourceType: varchar("source_type", { length: 20 }).notNull(),
        sourceId: integer("source_id").notNull(),
        orgId: uuid("org_id").notNull(),
        stepIndex: integer("step_index").default(0).notNull(),
        checkAt: timestamptz("check_at").notNull(),
        status: varchar("status", { length: 20 }).default("pending").notNull(), // pending | processing | sent | skipped | cancelled | held(명단 보류, DESIGN-SND 6-2)
        result: varchar("result", { length: 20 }),
        processedAt: timestamptz("processed_at"),
        /** processing 진입 시각 — 멈춘 줄 회수에 쓴다 */
        lockedAt: timestamptz("locked_at"),
        /** 멈춘 까닭 (0074, DESIGN-RPL 7-2·7-4): replied(회신) | bounced(반송). 사람이 취소한 줄은 NULL */
        stopReason: varchar("stop_reason", { length: 30 }),
        createdAt: timestamptz("created_at").defaultNow().notNull(),
    },
    (table) => ({
        statusCheckIdx: index("efq_status_check_idx").on(table.status, table.checkAt),
        parentLogStepIdx: uniqueIndex("efq_parent_log_step_idx").on(table.parentLogId, table.stepIndex),
    })
);

/** 메일 유입 5초 확인 뒤 후속 중단·감사 메일의 고객별 한 번 발송 기록. */
export const emailVisitAcknowledgements = pgTable("email_visit_acknowledgements", {
    id: serial("id").primaryKey(),
    orgId: uuid("org_id").references(() => organizations.id, { onDelete: "cascade" }).notNull(),
    workspaceId: integer("workspace_id").references(() => workspaces.id, { onDelete: "cascade" }).notNull(),
    customerKey: varchar("customer_key", { length: 64 }).notNull(),
    sourceLogId: integer("source_log_id").references(() => emailSendLogs.id, { onDelete: "cascade" }).notNull(),
    recordId: integer("record_id").notNull(),
    sessionId: integer("session_id").notNull(),
    status: varchar("status", { length: 20 }).default("pending").notNull(),
    reason: text("reason"),
    body: text("body"),
    queueId: integer("queue_id").references(() => emailFollowupQueue.id, { onDelete: "set null" }),
    sendLogId: integer("send_log_id").references(() => emailSendLogs.id, { onDelete: "set null" }),
    scheduledAt: timestamptz("scheduled_at").notNull(),
    observedAt: timestamptz("observed_at").notNull(),
    nextCheckAt: timestamptz("next_check_at").defaultNow().notNull(),
    createdAt: timestamptz("created_at").defaultNow().notNull(),
    updatedAt: timestamptz("updated_at").defaultNow().notNull(),
}, table => [
    uniqueIndex("eva_customer_idx").on(table.orgId, table.workspaceId, table.customerKey),
    index("eva_status_check_idx").on(table.status, table.nextCheckAt),
]);

/**
 * AI 개인화 이메일 대량 발송 큐.
 *
 * 발송 내용(제목/본문)은 담지 않는다 — AI가 발송 시점에 생성하므로 적재 시점엔 없다.
 * 워커가 record_id로 기존 processAutoPersonalizedEmail을 그대로 부른다.
 */
export const emailSendQueue = pgTable(
    "email_send_queue",
    {
        id: serial("id").primaryKey(),
        recordId: integer("record_id")
            .references(() => records.id, { onDelete: "cascade" })
            .notNull(),
        partitionId: integer("partition_id")
            .references(() => partitions.id, { onDelete: "cascade" })
            .notNull(),
        orgId: uuid("org_id").notNull(),
        triggerType: varchar("trigger_type", { length: 20 }).notNull(),
        status: varchar("status", { length: 20 }).default("pending").notNull(), // pending | processing | sent | skipped | failed | held(명단 보류 — 대량 줄만, DESIGN-SND 6-2)
        attempts: integer("attempts").default(0).notNull(),
        lastError: text("last_error"),
        /** processing 진입 시각 — stuck 판정에 쓴다 */
        lockedAt: timestamptz("locked_at"),
        /**
         * 이 시각 이후에 발송한다. 기본값 now()라 일반 업로드는 즉시 나간다.
         * 미래로 넣으면 그때까지 워커가 집지 않는다 (야간 발송 회피·재발송 예약).
         */
        scheduledAt: timestamptz("scheduled_at").defaultNow().notNull(),
        createdAt: timestamptz("created_at").defaultNow().notNull(),
        processedAt: timestamptz("processed_at"),
        /**
         * 시도 횟수를 다 써 이 줄에서 뺀 AI 규칙 id. 앞 규칙은 계속 실패하고 뒤 규칙은 발신 한도로 미뤄진 줄을
         * failed로 닫지 않고, 실패 규칙만 빼서 미룬 규칙을 retryAt에 다시 시도한다 (email-send-queue-rules.ts planQueueRow)
         */
        exhaustedLinkIds: jsonb("exhausted_link_ids").$type<number[]>(),
        /**
         * 워커가 처리하는 사이 바로 보내는 경로가 같은 줄을 다시 처리해 달라고 남긴 시각 (enqueueDeferredSend).
         * 워커가 보낼 것 없음·실패로 끝내려 할 때 이 값이 있으면 끝내지 않고 이 시각에 다시 꺼낸다
         */
        requeueAt: timestamptz("requeue_at"),
        /**
         * 0 = 대량 명단 (가져오기·예약 등록 → enqueueSends), 1 = 문의가 발신 한도에 막혀 들어온 줄 (enqueueDeferredSend).
         * 꺼낼 때 1이 먼저고(priority DESC, scheduled_at, id), 1인 줄은 그날 한도 전체를, 0인 줄은 15:00(KST) 전까지
         * 문의 몫(한도의 10%)을 뺀 한도를 쓴다 (docs/2026-10-02-sender-warmup/DESIGN-2-queue-policy.md 2절)
         */
        priority: smallint("priority").default(0).notNull(),
    },
    (table) => ({
        // 줄 집기 순서(pickBatch)와 같은 색인 (0072에서 예전 esq_pickup_idx(status, scheduled_at, id)를 바꿨다)
        pickupIdx: index("esq_pickup_priority_idx").on(
            table.status,
            table.priority.desc(),
            table.scheduledAt,
            table.id
        ),
        // 같은 레코드가 두 번 적재되는 것을 DB가 막는다 — 재업로드해도 메일이 두 번 나가지 않는다
        recordTriggerIdx: uniqueIndex("esq_record_trigger_idx").on(table.recordId, table.triggerType),
    })
);

// ============================================
// 제품/서비스 카탈로그
// ============================================
export const products = pgTable("products", {
    id: serial("id").primaryKey(),
    orgId: uuid("org_id")
        .references(() => organizations.id, { onDelete: "cascade" })
        .notNull(),
    name: varchar("name", { length: 200 }).notNull(),
    summary: varchar("summary", { length: 500 }),
    description: text("description"),
    category: varchar("category", { length: 100 }),
    price: varchar("price", { length: 100 }),
    url: varchar("url", { length: 500 }),
    imageUrl: varchar("image_url", { length: 500 }),
    isActive: integer("is_active").default(1).notNull(),
    sortOrder: integer("sort_order").default(0).notNull(),
    createdAt: timestamptz("created_at").defaultNow().notNull(),
    updatedAt: timestamptz("updated_at").defaultNow().notNull(),
});

// ============================================
// AI 설정 (조직별)
// ============================================
export const aiConfigs = pgTable("ai_configs", {
    id: serial("id").primaryKey(),
    orgId: uuid("org_id")
        .references(() => organizations.id, { onDelete: "cascade" })
        .unique()
        .notNull(),
    provider: varchar("provider", { length: 50 }).notNull(), // "openai" | "anthropic" | "gemini"
    apiKey: varchar("api_key", { length: 500 }).notNull(),
    model: varchar("model", { length: 100 }),
    isActive: integer("is_active").default(1).notNull(),
    createdAt: timestamptz("created_at").defaultNow().notNull(),
    updatedAt: timestamptz("updated_at").defaultNow().notNull(),
});

// ============================================
// AI 사용량 로그
// ============================================
export const aiUsageLogs = pgTable("ai_usage_logs", {
    id: serial("id").primaryKey(),
    orgId: uuid("org_id")
        .references(() => organizations.id, { onDelete: "cascade" })
        .notNull(),
    userId: uuid("user_id")
        .references(() => users.id, { onDelete: "set null" }),
    provider: varchar("provider", { length: 50 }).notNull(),
    model: varchar("model", { length: 100 }).notNull(),
    promptTokens: integer("prompt_tokens").notNull(),
    completionTokens: integer("completion_tokens").notNull(),
    purpose: varchar("purpose", { length: 50 }).notNull(),
    createdAt: timestamptz("created_at").defaultNow().notNull(),
});

// ============================================
// AI 사용량 쿼터 (조직별 월간)
// ============================================
export const aiUsageQuotas = pgTable("ai_usage_quotas", {
    id: serial("id").primaryKey(),
    orgId: uuid("org_id")
        .references(() => organizations.id, { onDelete: "cascade" })
        .notNull(),
    month: varchar("month", { length: 7 }).notNull(),
    totalTokens: bigint("total_tokens", { mode: "number" }).default(0).notNull(),
    quotaLimit: bigint("quota_limit", { mode: "number" }).default(100000).notNull(),
    createdAt: timestamptz("created_at").defaultNow().notNull(),
    updatedAt: timestamptz("updated_at").defaultNow().notNull(),
}, (table) => [
    unique().on(table.orgId, table.month),
]);

// ============================================
// 조직 초대
// ============================================
export const organizationInvitations = pgTable("organization_invitations", {
    id: serial("id").primaryKey(),
    orgId: uuid("org_id")
        .references(() => organizations.id, { onDelete: "cascade" })
        .notNull(),
    email: varchar("email", { length: 255 }).notNull(),
    role: varchar("role", { length: 20 }).default("member").notNull(),
    token: varchar("token", { length: 64 }).unique().notNull(),
    status: varchar("status", { length: 20 }).default("pending").notNull(), // pending | accepted | cancelled
    invitedBy: uuid("invited_by")
        .references(() => users.id)
        .notNull(),
    expiresAt: timestamptz("expires_at").notNull(),
    createdAt: timestamptz("created_at").defaultNow().notNull(),
});

// ============================================
// 조직 멤버십 (다대다)
// ============================================
export const organizationMembers = pgTable(
    "organization_members",
    {
        id: serial("id").primaryKey(),
        organizationId: uuid("organization_id")
            .notNull()
            .references(() => organizations.id, { onDelete: "cascade" }),
        userId: uuid("user_id")
            .notNull()
            .references(() => users.id, { onDelete: "cascade" }),
        role: varchar("role", { length: 20 }).notNull(), // owner | admin | member
        // role이 바뀔 때마다 +1. JWT에 구워진 값과 다르면 관리자 경로에서 거부된다.
        tokenVersion: integer("token_version").default(0).notNull(),
        joinedAt: timestamptz("joined_at").defaultNow().notNull(),
    },
    (table) => ({
        orgUserUnique: unique().on(table.organizationId, table.userId),
        userIdx: index("org_members_user_idx").on(table.userId),
    })
);

// ============================================
// 웹 폼
// ============================================
export const webForms = pgTable("web_forms", {
    id: serial("id").primaryKey(),
    orgId: uuid("org_id")
        .references(() => organizations.id, { onDelete: "cascade" })
        .notNull(),
    workspaceId: integer("workspace_id")
        .references(() => workspaces.id, { onDelete: "cascade" })
        .notNull(),
    partitionId: integer("partition_id")
        .references(() => partitions.id, { onDelete: "cascade" })
        .notNull(),
    name: varchar("name", { length: 200 }).notNull(),
    slug: varchar("slug", { length: 100 }).unique().notNull(),
    title: varchar("title", { length: 200 }).notNull(),
    description: text("description"),
    completionTitle: varchar("completion_title", { length: 200 }).default("제출이 완료되었습니다"),
    completionMessage: text("completion_message"),
    completionButtonText: varchar("completion_button_text", { length: 100 }),
    completionButtonUrl: text("completion_button_url"),
    defaultValues: jsonb("default_values").$type<{ field: string; value: string }[]>(),
    isActive: integer("is_active").default(1).notNull(),
    createdBy: uuid("created_by").references(() => users.id),
    createdAt: timestamptz("created_at").defaultNow().notNull(),
    updatedAt: timestamptz("updated_at").defaultNow().notNull(),
});

export const webFormFields = pgTable("web_form_fields", {
    id: serial("id").primaryKey(),
    formId: integer("form_id")
        .references(() => webForms.id, { onDelete: "cascade" })
        .notNull(),
    label: varchar("label", { length: 200 }).notNull(),
    description: text("description"),
    placeholder: varchar("placeholder", { length: 200 }),
    fieldType: varchar("field_type", { length: 20 }).default("text").notNull(),
    linkedFieldKey: varchar("linked_field_key", { length: 100 }),
    isRequired: integer("is_required").default(0).notNull(),
    options: jsonb("options").$type<string[]>(),
    sortOrder: integer("sort_order").default(0).notNull(),
    createdAt: timestamptz("created_at").defaultNow().notNull(),
    updatedAt: timestamptz("updated_at").defaultNow().notNull(),
});

// ============================================
// 요금제 플랜
// ============================================
export const plans = pgTable("plans", {
    id: serial("id").primaryKey(),
    name: varchar("name", { length: 50 }).notNull(),
    slug: varchar("slug", { length: 50 }).unique().notNull(),
    price: integer("price").notNull(),
    limits: jsonb("limits").$type<{
        workspaces: number;
        records: number;
        members: number;
    }>().notNull(),
    features: jsonb("features").$type<string[]>().notNull(),
    sortOrder: integer("sort_order").default(0).notNull(),
    createdAt: timestamptz("created_at").defaultNow().notNull(),
});

// ============================================
// 구독
// ============================================
export const subscriptions = pgTable("subscriptions", {
    id: serial("id").primaryKey(),
    orgId: uuid("org_id")
        .references(() => organizations.id, { onDelete: "cascade" })
        .notNull(),
    planId: integer("plan_id")
        .references(() => plans.id)
        .notNull(),
    status: varchar("status", { length: 20 }).default("active").notNull(),
    currentPeriodStart: timestamptz("current_period_start"),
    currentPeriodEnd: timestamptz("current_period_end"),
    tossCustomerKey: varchar("toss_customer_key", { length: 200 }),
    tossBillingKey: varchar("toss_billing_key", { length: 200 }),
    cardInfo: jsonb("card_info").$type<{ cardCompany: string; cardNumber: string }>(),
    retryCount: integer("retry_count").default(0).notNull(),
    nextRetryAt: timestamptz("next_retry_at"),
    canceledAt: timestamptz("canceled_at"),
    createdAt: timestamptz("created_at").defaultNow().notNull(),
    updatedAt: timestamptz("updated_at").defaultNow().notNull(),
});

// ============================================
// 결제 내역
// ============================================
export const payments = pgTable("payments", {
    id: serial("id").primaryKey(),
    orgId: uuid("org_id")
        .references(() => organizations.id, { onDelete: "cascade" })
        .notNull(),
    subscriptionId: integer("subscription_id")
        .references(() => subscriptions.id),
    amount: integer("amount").notNull(),
    status: varchar("status", { length: 20 }).notNull(),
    tossPaymentKey: varchar("toss_payment_key", { length: 200 }),
    tossOrderId: varchar("toss_order_id", { length: 200 }),
    paidAt: timestamptz("paid_at"),
    failReason: text("fail_reason"),
    createdAt: timestamptz("created_at").defaultNow().notNull(),
});

// ============================================
// 레코드 자동 웹검색 보강
// ============================================
export const recordAutoEnrichRules = pgTable("record_auto_enrich_rules", {
    id: serial("id").primaryKey(),
    orgId: uuid("org_id")
        .references(() => organizations.id, { onDelete: "cascade" })
        .notNull(),
    partitionId: integer("partition_id")
        .references(() => partitions.id, { onDelete: "cascade" })
        .notNull(),
    searchField: varchar("search_field", { length: 100 }).notNull(),
    targetFields: jsonb("target_fields").$type<string[]>().notNull(),
    isActive: integer("is_active").default(1).notNull(),
    createdAt: timestamptz("created_at").defaultNow().notNull(),
    updatedAt: timestamptz("updated_at").defaultNow().notNull(),
});

// ============================================
// 이메일 발신자 프로필 (조직별 다중)
// ============================================
export const emailSenderProfiles = pgTable("email_sender_profiles", {
    id: serial("id").primaryKey(),
    orgId: uuid("org_id")
        .references(() => organizations.id, { onDelete: "cascade" })
        .notNull(),
    name: varchar("name", { length: 100 }).notNull(),
    fromName: varchar("from_name", { length: 100 }).notNull(),
    fromEmail: varchar("from_email", { length: 200 }).notNull(),
    isDefault: boolean("is_default").default(false).notNull(),
    // 발송 한도·웜업 (docs/2026-10-02-sender-warmup/DESIGN.md 4절).
    // 전부 기본값이 "꺼짐"이라 설정하지 않은 주소는 지금처럼 바로 나간다
    dailyLimit: integer("daily_limit"),
    warmupEnabled: boolean("warmup_enabled").default(false).notNull(),
    warmupStartCount: integer("warmup_start_count"),
    warmupStep: integer("warmup_step"),
    // "YYYY-MM-DD" KST. 웜업을 켤 때 서버가 기록한다
    warmupStartedOn: varchar("warmup_started_on", { length: 10 }),
    sendWindowStart: integer("send_window_start"), // 0~23 KST, 포함
    sendWindowEnd: integer("send_window_end"), // 1~24 KST, 미포함
    weekdaysOnly: boolean("weekdays_only").default(false).notNull(),
    spreadEvenly: boolean("spread_evenly").default(false).notNull(),
    isPaused: boolean("is_paused").default(false).notNull(),
    // 발신 건강 (0075, DESIGN-SND 6-3·6-5). 자리 잡기 판정과는 상관없다 — 판정은 is_paused 하나만 본다
    /** 누가 멈췄나: manual(사람) | auto(발신 건강 자동 멈춤). 멈춰 있지 않으면 NULL */
    pausedSource: varchar("paused_source", { length: 10 }),
    pausedReason: text("paused_reason"),
    pausedAt: timestamptz("paused_at"),
    /** 건강 조치 방식: auto(자동 멈춤) | alert(알림만). 조직 기본 주소는 이 값과 상관없이 늘 알림만 (코드가 막는다) */
    healthAction: varchar("health_action", { length: 10 }).default("auto").notNull(),
    /** 자동 멈춤을 푼 시각 — 이 시각 뒤 발송만으로 다시 판정한다 (5-2 재판정 유예) */
    healthResetAt: timestamptz("health_reset_at"),
    createdAt: timestamptz("created_at").defaultNow().notNull(),
    updatedAt: timestamptz("updated_at").defaultNow().notNull(),
});

// ============================================
// 발신 주소별 하루 사용량 (KST 날짜)
// ============================================
// 로그를 세지 않고 예약 수를 센다 — email_send_logs에는 (sender_profile_id, sent_at) 인덱스가 없고,
// AI 첫 메일은 로그를 AI 생성 뒤에 넣어서 로그로 세면 판정이 늦다.
// usage_date를 date 형으로 두지 않는 것은 DB 세션 시간대에 따라 날짜가 바뀔 수 있어서다.
export const emailSenderDailyUsage = pgTable(
    "email_sender_daily_usage",
    {
        senderProfileId: integer("sender_profile_id")
            .references(() => emailSenderProfiles.id, { onDelete: "cascade" })
            .notNull(),
        usageDate: varchar("usage_date", { length: 10 }).notNull(), // "YYYY-MM-DD" KST
        sentCount: integer("sent_count").default(0).notNull(),
        lastSentAt: timestamptz("last_sent_at"),
    },
    // 이름을 마이그레이션 SQL의 기본 이름과 맞춘다 — 다르면 drizzle-kit이 PK를 다시 만들려 한다
    (table) => [
        primaryKey({ name: "email_sender_daily_usage_pkey", columns: [table.senderProfileId, table.usageDate] }),
    ]
);

// ============================================
// 미리 작성한 대량 AI 메일과 주소별 하루 무작위 예약. 사용량 카운터는 실제 발송 직전에만 올린다.
// ============================================
export const emailSenderDailyPlans = pgTable("email_sender_daily_plans", {
    senderProfileId: integer("sender_profile_id").references(() => emailSenderProfiles.id, { onDelete: "cascade" }).notNull(),
    usageDate: varchar("usage_date", { length: 10 }).notNull(),
    /** 처음 준비한 시점 이후 남은 시간대에 하루 할당량을 배분하며 재시작해도 기준을 유지한다. */
    startAt: timestamptz("start_at").notNull(),
}, (table) => [primaryKey({ columns: [table.senderProfileId, table.usageDate] })]);

export interface PreparedEmailPayload {
    recipientEmail: string;
    subject: string;
    body: string;
    unsubscribeToken: string | null;
    aiCopyJobId?: number;
    experimentAssignmentId?: number;
}

export const emailPreparedSends = pgTable("email_prepared_sends", {
    id: serial("id").primaryKey(),
    queueId: integer("queue_id").references(() => emailSendQueue.id, { onDelete: "cascade" }).notNull(),
    linkId: integer("link_id").references(() => emailAutoPersonalizedLinks.id, { onDelete: "cascade" }).notNull(),
    orgId: uuid("org_id").references(() => organizations.id, { onDelete: "cascade" }).notNull(),
    senderProfileId: integer("sender_profile_id").references(() => emailSenderProfiles.id, { onDelete: "cascade" }).notNull(),
    usageDate: varchar("usage_date", { length: 10 }).notNull(),
    ordinal: integer("ordinal").notNull(),
    scheduledAt: timestamptz("scheduled_at").notNull(),
    sourceHash: varchar("source_hash", { length: 64 }).notNull(),
    payload: jsonb("payload").$type<PreparedEmailPayload>(),
    status: varchar("status", { length: 20 }).default("reserved").notNull(), // reserved | ready | sending | sent | uncertain | cancelled
    logId: integer("log_id").references(() => emailSendLogs.id, { onDelete: "set null" }),
    createdAt: timestamptz("created_at").defaultNow().notNull(),
    updatedAt: timestamptz("updated_at").defaultNow().notNull(),
}, (table) => [
    uniqueIndex("eps_queue_link_idx").on(table.queueId, table.linkId),
    uniqueIndex("eps_slot_idx").on(table.senderProfileId, table.usageDate, table.ordinal).where(sql`${table.status} <> 'cancelled'`),
    index("eps_sender_day_idx").on(table.senderProfileId, table.usageDate, table.status),
]);

export type PreparedSend = typeof emailPreparedSends.$inferSelect;

// ============================================
// 이메일 서명 (조직별 다중)
// ============================================
export const emailSignatures = pgTable("email_signatures", {
    id: serial("id").primaryKey(),
    orgId: uuid("org_id")
        .references(() => organizations.id, { onDelete: "cascade" })
        .notNull(),
    name: varchar("name", { length: 100 }).notNull(),
    signature: text("signature").notNull(),
    isDefault: boolean("is_default").default(false).notNull(),
    createdAt: timestamptz("created_at").defaultNow().notNull(),
    updatedAt: timestamptz("updated_at").defaultNow().notNull(),
});

// ============================================
// 광고 플랫폼 연결
// ============================================
export const adPlatforms = pgTable("ad_platforms", {
    id: serial("id").primaryKey(),
    orgId: uuid("org_id")
        .references(() => organizations.id, { onDelete: "cascade" })
        .notNull(),
    platform: varchar("platform", { length: 20 }).notNull(), // 'meta' | 'google' | 'naver'
    name: varchar("name", { length: 200 }).notNull(),
    credentials: jsonb("credentials").notNull(), // AdPlatformCredentials (see types/index.ts)
    status: varchar("status", { length: 20 }).default("connected").notNull(),
    // 'connected' | 'expired' | 'error' | 'disconnected'
    lastSyncAt: timestamptz("last_sync_at"),
    createdBy: uuid("created_by")
        .references(() => users.id, { onDelete: "set null" }),
    createdAt: timestamptz("created_at").defaultNow().notNull(),
    updatedAt: timestamptz("updated_at").defaultNow().notNull(),
}, (table) => ({
    orgPlatformNameUnique: unique().on(table.orgId, table.platform, table.name),
}));

// ============================================
// 광고 계정
// ============================================
export const adAccounts = pgTable("ad_accounts", {
    id: serial("id").primaryKey(),
    adPlatformId: integer("ad_platform_id")
        .references(() => adPlatforms.id, { onDelete: "cascade" })
        .notNull(),
    workspaceId: integer("workspace_id")
        .references(() => workspaces.id, { onDelete: "set null" }),
    externalAccountId: varchar("external_account_id", { length: 100 }).notNull(),
    name: varchar("name", { length: 200 }).notNull(),
    currency: varchar("currency", { length: 10 }),
    status: varchar("status", { length: 20 }).default("active").notNull(),
    // 'active' | 'paused' | 'disabled'
    metadata: jsonb("metadata"),
    lastSyncAt: timestamptz("last_sync_at"),
    createdAt: timestamptz("created_at").defaultNow().notNull(),
    updatedAt: timestamptz("updated_at").defaultNow().notNull(),
}, (table) => ({
    platformAccountUnique: unique().on(table.adPlatformId, table.externalAccountId),
}));

// ============================================
// 광고 리드 연동 설정
// ============================================
export const adLeadIntegrations = pgTable("ad_lead_integrations", {
    id: serial("id").primaryKey(),
    orgId: uuid("org_id")
        .references(() => organizations.id, { onDelete: "cascade" })
        .notNull(),
    adAccountId: integer("ad_account_id")
        .references(() => adAccounts.id, { onDelete: "cascade" })
        .notNull(),
    name: varchar("name", { length: 200 }).notNull(),
    platform: varchar("platform", { length: 20 }).notNull(), // denormalized for webhook lookup
    partitionId: integer("partition_id")
        .references(() => partitions.id, { onDelete: "set null" }),
    formId: varchar("form_id", { length: 200 }).notNull(),
    formName: varchar("form_name", { length: 200 }),
    fieldMappings: jsonb("field_mappings").notNull(), // { "platform_field": "db_column" }
    defaultValues: jsonb("default_values"), // { "column": "fixed_value" }
    isActive: integer("is_active").default(1).notNull(),
    createdBy: uuid("created_by")
        .references(() => users.id, { onDelete: "set null" }),
    createdAt: timestamptz("created_at").defaultNow().notNull(),
    updatedAt: timestamptz("updated_at").defaultNow().notNull(),
}, (table) => ({
    accountFormUnique: unique().on(table.adAccountId, table.formId),
    formIdIdx: index("ad_lead_integrations_form_id_idx").on(table.formId),
    platformIdx: index("ad_lead_integrations_platform_idx").on(table.platform),
}));

// ============================================
// 광고 리드 수집 로그
// ============================================
export const adLeadLogs = pgTable("ad_lead_logs", {
    id: serial("id").primaryKey(),
    integrationId: integer("integration_id")
        .references(() => adLeadIntegrations.id, { onDelete: "cascade" })
        .notNull(),
    externalLeadId: varchar("external_lead_id", { length: 200 }),
    recordId: integer("record_id"),
    rawData: jsonb("raw_data"),
    status: varchar("status", { length: 20 }).default("success").notNull(),
    // 'success' | 'failed' | 'duplicate' | 'skipped'
    errorMessage: text("error_message"),
    processedAt: timestamptz("processed_at").defaultNow(),
    createdAt: timestamptz("created_at").defaultNow().notNull(),
}, (table) => ({
    integrationCreatedIdx: index("ad_lead_logs_integration_created_idx")
        .on(table.integrationId, table.createdAt),
    externalLeadIdx: index("ad_lead_logs_external_lead_idx")
        .on(table.externalLeadId),
}));

// ============================================
// 타입 추출
// ============================================
export type Organization = typeof organizations.$inferSelect;
export type NewOrganization = typeof organizations.$inferInsert;
export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
export type Workspace = typeof workspaces.$inferSelect;
export type NewWorkspace = typeof workspaces.$inferInsert;
export type FieldDefinitionRow = typeof fieldDefinitions.$inferSelect;
export type NewFieldDefinition = typeof fieldDefinitions.$inferInsert;
export type Folder = typeof folders.$inferSelect;
export type NewFolder = typeof folders.$inferInsert;
export type Partition = typeof partitions.$inferSelect;
export type NewPartition = typeof partitions.$inferInsert;
export type DbRecord = typeof records.$inferSelect;
export type NewDbRecord = typeof records.$inferInsert;
export type Memo = typeof memos.$inferSelect;
export type NewMemo = typeof memos.$inferInsert;
export type WorkspacePermission = typeof workspacePermissions.$inferSelect;
export type PartitionPermission = typeof partitionPermissions.$inferSelect;
export type MemberScope = typeof memberScopes.$inferSelect;
export type NewMemberScope = typeof memberScopes.$inferInsert;
export type StatusOptionCategory = typeof statusOptionCategories.$inferSelect;
export type StatusOption = typeof statusOptions.$inferSelect;
export type ApiToken = typeof apiTokens.$inferSelect;
export type AlimtalkConfig = typeof alimtalkConfigs.$inferSelect;
export type AlimtalkTemplateLink = typeof alimtalkTemplateLinks.$inferSelect;
export type AlimtalkSendLog = typeof alimtalkSendLogs.$inferSelect;
export type AlimtalkAutomationQueueRow = typeof alimtalkAutomationQueue.$inferSelect;
export type EmailConfig = typeof emailConfigs.$inferSelect;
export type EmailTemplate = typeof emailTemplates.$inferSelect;
export type EmailTemplateLink = typeof emailTemplateLinks.$inferSelect;
export type EmailSendLog = typeof emailSendLogs.$inferSelect;
export type EmailAutomationQueueRow = typeof emailAutomationQueue.$inferSelect;
export type EmailSendQueueRow = typeof emailSendQueue.$inferSelect;
export type EmailAutoPersonalizedLink = typeof emailAutoPersonalizedLinks.$inferSelect;
export type EmailAsset = typeof emailAssets.$inferSelect;
export type NewEmailAsset = typeof emailAssets.$inferInsert;
export type Product = typeof products.$inferSelect;
export type NewProduct = typeof products.$inferInsert;
export type AiConfig = typeof aiConfigs.$inferSelect;
export type AiUsageLog = typeof aiUsageLogs.$inferSelect;
export type AiUsageQuota = typeof aiUsageQuotas.$inferSelect;
export type OrganizationInvitation = typeof organizationInvitations.$inferSelect;
export type NewOrganizationInvitation = typeof organizationInvitations.$inferInsert;
export type OrganizationMember = typeof organizationMembers.$inferSelect;
export type NewOrganizationMember = typeof organizationMembers.$inferInsert;
export type WebForm = typeof webForms.$inferSelect;
export type NewWebForm = typeof webForms.$inferInsert;
export type WebFormField = typeof webFormFields.$inferSelect;
export type NewWebFormField = typeof webFormFields.$inferInsert;
export type Plan = typeof plans.$inferSelect;
export type Subscription = typeof subscriptions.$inferSelect;
export type Payment = typeof payments.$inferSelect;
export type RecordAutoEnrichRule = typeof recordAutoEnrichRules.$inferSelect;
export type EmailSenderProfile = typeof emailSenderProfiles.$inferSelect;
export type EmailSenderDailyUsage = typeof emailSenderDailyUsage.$inferSelect;
export type EmailSignature = typeof emailSignatures.$inferSelect;
export type AdPlatform = typeof adPlatforms.$inferSelect;
export type NewAdPlatform = typeof adPlatforms.$inferInsert;
export type AdAccount = typeof adAccounts.$inferSelect;
export type NewAdAccount = typeof adAccounts.$inferInsert;
export type AdLeadIntegration = typeof adLeadIntegrations.$inferSelect;
export type NewAdLeadIntegration = typeof adLeadIntegrations.$inferInsert;
export type AdLeadLog = typeof adLeadLogs.$inferSelect;
export type NewAdLeadLog = typeof adLeadLogs.$inferInsert;

// ============================================
// 트래커 (Visitor Behavior Tracker)
// ============================================
export const trackerSites = pgTable("tracker_sites", {
    id: serial("id").primaryKey(),
    orgId: uuid("org_id")
        .references(() => organizations.id, { onDelete: "cascade" })
        .notNull(),
    workspaceId: integer("workspace_id")
        .references(() => workspaces.id, { onDelete: "cascade" })
        .notNull(),
    name: varchar("name", { length: 200 }).notNull(),
    apiKey: varchar("api_key", { length: 64 }).notNull().unique(),
    domains: jsonb("domains").$type<string[]>().notNull().default([]),
    isActive: integer("is_active").default(1).notNull(),
    // identify 매칭 필드 — NULL이면 email/phone 기본
    matchField: varchar("match_field", { length: 100 }),
    // 분석에서 제외할 경로 prefix 배열 (예: ["/main/", "/login/"]) — 로그인 후 영역 제외용
    excludePaths: jsonb("exclude_paths").$type<string[]>().notNull().default([]),
    // 전환 완료 단계명 (record.data[matchStep] 값과 매칭) — 디하=구독중. NULL이면 깔때기 3단까지만
    conversionStage: varchar("conversion_stage", { length: 100 }),
    createdAt: timestamptz("created_at").defaultNow().notNull(),
    updatedAt: timestamptz("updated_at").defaultNow().notNull(),
}, (table) => [
    unique("tracker_sites_workspace_unique").on(table.workspaceId),
    uniqueIndex("tracker_sites_api_key_idx").on(table.apiKey),
]);

/**
 * 사이트별 사용자정의 퍼널.
 * "방문/리드"는 자동 단계로 코드가 처리. 3단부터 stages jsonb로 사용자가 정의.
 * 각 stage는 매칭 조건(record_field / page_url) 중 하나.
 *   - record_field: 필드+값. 시스템이 자동으로 현재 상태 + 변경 이력 합집합 매칭.
 *   - page_url: 특정 경로 prefix 방문.
 */
export const trackerFunnels = pgTable("tracker_funnels", {
    id: serial("id").primaryKey(),
    orgId: uuid("org_id")
        .references(() => organizations.id, { onDelete: "cascade" })
        .notNull(),
    siteId: integer("site_id")
        .references(() => trackerSites.id, { onDelete: "cascade" })
        .notNull(),
    name: varchar("name", { length: 200 }).notNull(),
    // 'marketing'(상태 기반 + 역산) | 'event'(행동 custom_event 단계, 역산 미적용). default 'marketing' → 기존 무영향.
    kind: varchar("kind", { length: 20 }).default("marketing").notNull(),
    // FunnelStage[] — components/tracker/types/funnel.ts 참조
    stages: jsonb("stages").$type<FunnelStageData[]>().notNull().default([]),
    isDefault: integer("is_default").default(0).notNull(),
    createdAt: timestamptz("created_at").defaultNow().notNull(),
    updatedAt: timestamptz("updated_at").defaultNow().notNull(),
}, (table) => [
    index("tracker_funnels_site_idx").on(table.siteId),
]);

// schema에서는 직접 타입을 정의 (UI types 파일과 동기화 필요 — src/components/tracker/types/funnel.ts)
type FunnelStageData = {
    key: string;
    label: string;
    match:
        | { type: "record_field"; field: string; value: string }
        | { type: "page_url"; pathPrefix: string }
        | { type: "custom_event"; eventName: string };
};

export type TrackerFunnel = typeof trackerFunnels.$inferSelect;
export type NewTrackerFunnel = typeof trackerFunnels.$inferInsert;

/**
 * 사이트별 이벤트 이름 별칭(라벨) 매핑.
 * 운영자가 SECTION_VIEW/CLICK 이벤트의 raw 이름에 한글 라벨을 매핑.
 */
export const trackerEventAliases = pgTable("tracker_event_aliases", {
    id: serial("id").primaryKey(),
    orgId: uuid("org_id")
        .references(() => organizations.id, { onDelete: "cascade" })
        .notNull(),
    siteId: integer("site_id")
        .references(() => trackerSites.id, { onDelete: "cascade" })
        .notNull(),
    eventType: varchar("event_type", { length: 30 }).notNull(), // 'SECTION_VIEW' | 'CLICK'
    eventName: varchar("event_name", { length: 100 }).notNull(),
    label: varchar("label", { length: 200 }).notNull(),
    createdAt: timestamptz("created_at").defaultNow().notNull(),
    updatedAt: timestamptz("updated_at").defaultNow().notNull(),
}, (table) => [
    unique("tracker_event_aliases_site_type_name_unique")
        .on(table.siteId, table.eventType, table.eventName),
    index("tracker_event_aliases_site_idx").on(table.siteId),
]);

export type TrackerEventAlias = typeof trackerEventAliases.$inferSelect;
export type NewTrackerEventAlias = typeof trackerEventAliases.$inferInsert;

export const trackerVisitors = pgTable("tracker_visitors", {
    id: serial("id").primaryKey(),
    orgId: uuid("org_id")
        .references(() => organizations.id, { onDelete: "cascade" })
        .notNull(),
    siteId: integer("site_id")
        .references(() => trackerSites.id, { onDelete: "cascade" })
        .notNull(),
    visitorId: varchar("visitor_id", { length: 64 }).notNull(),
    // soft FK (records 삭제 시 NULLify는 application 책임)
    recordId: integer("record_id"),
    // identify로 받은 식별자 값 (site.matchField에 대응) — 역매칭 키로 보존
    matchValue: varchar("match_value", { length: 200 }),
    email: varchar("email", { length: 200 }),
    name: varchar("name", { length: 100 }),
    phone: varchar("phone", { length: 20 }),
    firstSeenAt: timestamptz("first_seen_at").defaultNow().notNull(),
    lastSeenAt: timestamptz("last_seen_at").defaultNow().notNull(),
    totalVisits: integer("total_visits").default(1).notNull(),
    totalPageviews: integer("total_pageviews").default(0).notNull(),
    totalEvents: integer("total_events").default(0).notNull(),
    deviceType: varchar("device_type", { length: 20 }),
    browser: varchar("browser", { length: 50 }),
    os: varchar("os", { length: 50 }),
    firstUtmSource: varchar("first_utm_source", { length: 100 }),
    firstUtmMedium: varchar("first_utm_medium", { length: 100 }),
    firstUtmCampaign: varchar("first_utm_campaign", { length: 200 }),
    lastUtmSource: varchar("last_utm_source", { length: 100 }),
    lastUtmMedium: varchar("last_utm_medium", { length: 100 }),
    lastUtmCampaign: varchar("last_utm_campaign", { length: 200 }),
    firstReferrer: text("first_referrer"),
    lastReferrer: text("last_referrer"),
    lastPage: text("last_page"),
    lastEvent: varchar("last_event", { length: 100 }),
    lastEventAt: timestamptz("last_event_at"),
    createdAt: timestamptz("created_at").defaultNow().notNull(),
    updatedAt: timestamptz("updated_at").defaultNow().notNull(),
}, (table) => [
    uniqueIndex("tracker_visitors_site_visitor_idx").on(table.siteId, table.visitorId),
    index("tracker_visitors_record_id_idx").on(table.recordId),
    index("tracker_visitors_match_value_idx").on(table.siteId, table.matchValue),
    index("tracker_visitors_email_idx").on(table.email),
    index("tracker_visitors_site_last_seen_idx").on(table.siteId, table.lastSeenAt),
]);

export const trackerSessions = pgTable("tracker_sessions", {
    id: serial("id").primaryKey(),
    siteId: integer("site_id")
        .references(() => trackerSites.id, { onDelete: "cascade" })
        .notNull(),
    visitorId: integer("visitor_id")
        .references(() => trackerVisitors.id, { onDelete: "cascade" })
        .notNull(),
    sessionKey: varchar("session_key", { length: 64 }).notNull(),
    startedAt: timestamptz("started_at").defaultNow().notNull(),
    endedAt: timestamptz("ended_at"),
    duration: integer("duration"),
    landingPage: text("landing_page"),
    exitPage: text("exit_page"),
    pageCount: integer("page_count").default(0).notNull(),
    trafficSource: varchar("traffic_source", { length: 20 }),
    referrer: text("referrer"),
    utmSource: varchar("utm_source", { length: 100 }),
    utmMedium: varchar("utm_medium", { length: 100 }),
    utmCampaign: varchar("utm_campaign", { length: 200 }),
    utmTerm: varchar("utm_term", { length: 200 }),
    utmContent: varchar("utm_content", { length: 200 }),
    clickId: varchar("click_id", { length: 64 }),
    isFirstVisit: integer("is_first_visit").default(0).notNull(),
}, (table) => [
    uniqueIndex("tracker_sessions_session_key_idx").on(table.siteId, table.sessionKey),
    index("tracker_sessions_visitor_idx").on(table.visitorId),
    index("tracker_sessions_started_idx").on(table.siteId, table.startedAt),
    index("tracker_sessions_click_id_idx").on(table.clickId),
]);

export const trackerEvents = pgTable("tracker_events", {
    id: serial("id").primaryKey(),
    siteId: integer("site_id")
        .references(() => trackerSites.id, { onDelete: "cascade" })
        .notNull(),
    sessionId: integer("session_id")
        .references(() => trackerSessions.id, { onDelete: "cascade" })
        .notNull(),
    visitorId: integer("visitor_id")
        .references(() => trackerVisitors.id, { onDelete: "cascade" })
        .notNull(),
    eventType: varchar("event_type", { length: 30 }).notNull(),
    eventName: varchar("event_name", { length: 100 }),
    pageUrl: text("page_url"),
    pageTitle: text("page_title"),
    properties: jsonb("properties"),
    revenue: numeric("revenue", { precision: 14, scale: 2 }),
    occurredAt: timestamptz("occurred_at").defaultNow().notNull(),
}, (table) => [
    index("tracker_events_visitor_occurred_idx").on(table.visitorId, table.occurredAt),
    index("tracker_events_site_occurred_idx").on(table.siteId, table.occurredAt),
    index("tracker_events_type_idx").on(table.siteId, table.eventType),
    index("tracker_events_session_idx").on(table.sessionId),
]);

export type TrackerSite = typeof trackerSites.$inferSelect;
export type NewTrackerSite = typeof trackerSites.$inferInsert;
export type TrackerVisitor = typeof trackerVisitors.$inferSelect;
export type NewTrackerVisitor = typeof trackerVisitors.$inferInsert;
export type TrackerSession = typeof trackerSessions.$inferSelect;
export type NewTrackerSession = typeof trackerSessions.$inferInsert;
export type TrackerEvent = typeof trackerEvents.$inferSelect;
export type NewTrackerEvent = typeof trackerEvents.$inferInsert;

// ============================================
// 방문자 ↔ 레코드 다중 연결 (N:M)
// ============================================
export const visitorRecordLinks = pgTable("visitor_record_links", {
    id: serial("id").primaryKey(),
    orgId: uuid("org_id").notNull(),
    visitorId: integer("visitor_id")
        .references(() => trackerVisitors.id, { onDelete: "cascade" })
        .notNull(),
    recordId: integer("record_id")
        .references(() => records.id, { onDelete: "cascade" })
        .notNull(),
    source: varchar("source", { length: 30 }).default("identify_match").notNull(),
    linkedAt: timestamptz("linked_at").defaultNow().notNull(),
}, (table) => [
    unique().on(table.visitorId, table.recordId),
    index("vrl_visitor_idx").on(table.visitorId),
    index("vrl_record_idx").on(table.recordId),
]);

export type VisitorRecordLink = typeof visitorRecordLinks.$inferSelect;
export type NewVisitorRecordLink = typeof visitorRecordLinks.$inferInsert;

// ============================================
// 레코드 이벤트 (비즈니스 이벤트 이력, append-only)
// ============================================
export const recordEvents = pgTable("record_events", {
    id: serial("id").primaryKey(),
    orgId: uuid("org_id").notNull(),
    recordId: integer("record_id")
        .references(() => records.id, { onDelete: "cascade" })
        .notNull(),
    type: varchar("type", { length: 50 }).notNull(),
    label: varchar("label", { length: 100 }).notNull(),
    occurredAt: timestamptz("occurred_at").defaultNow().notNull(),
    meta: jsonb("meta").$type<Record<string, unknown>>(),
    createdAt: timestamptz("created_at").defaultNow().notNull(),
}, (table) => [
    index("record_events_record_occurred_idx").on(table.recordId, table.occurredAt),
    index("record_events_org_type_idx").on(table.orgId, table.type),
]);

export type RecordEvent = typeof recordEvents.$inferSelect;
export type NewRecordEvent = typeof recordEvents.$inferInsert;

// ============================================
// 깊이 들어온 사람 알림 (구글 챗) — docs/2026-10-02-deep-visitor-alert/DESIGN.md 6절
// ============================================
// (레코드, 수준)당 한 줄. 5분마다 도는 워커가 같은 사람을 같은 수준으로 다시 보내지 않게
// 유니크 키가 막는다 (deep → intent로 올라갈 때만 한 줄 더 생긴다).
export const deepVisitorAlerts = pgTable("deep_visitor_alerts", {
    id: serial("id").primaryKey(),
    orgId: uuid("org_id").notNull(),
    workspaceId: integer("workspace_id").notNull(),
    siteId: integer("site_id"),
    recordId: integer("record_id")
        .references(() => records.id, { onDelete: "cascade" })
        .notNull(),
    // 발송·세션·방문자는 FK를 걸지 않는다 — 원본이 지워져도 알림 기록은 남긴다
    sendLogId: integer("send_log_id"),
    sessionId: integer("session_id"),
    visitorId: integer("visitor_id"),
    level: varchar("level", { length: 20 }).notNull(), // deep | intent
    angle: varchar("angle", { length: 5 }).notNull(), // A~E
    deepestStage: integer("deepest_stage").notNull(),
    status: varchar("status", { length: 20 }).default("pending").notNull(), // pending | processing | sent | failed | skipped | dry_run
    attempts: integer("attempts").default(0).notNull(),
    lastError: text("last_error"),
    // 카드 글자 그대로 — dry_run에서 무엇이 나갈지 확인할 수 있다
    message: text("message").notNull(),
    detectedAt: timestamptz("detected_at").defaultNow().notNull(),
    scheduledAt: timestamptz("scheduled_at").defaultNow().notNull(),
    /** processing 진입 시각 — stuck 판정에 쓴다 */
    lockedAt: timestamptz("locked_at"),
    sentAt: timestamptz("sent_at"),
}, (table) => [
    uniqueIndex("dva_record_level_idx").on(table.recordId, table.level),
    index("dva_pickup_idx").on(table.status, table.scheduledAt, table.id),
    index("dva_org_detected_idx").on(table.orgId, table.detectedAt),
]);

export type DeepVisitorAlert = typeof deepVisitorAlerts.$inferSelect;
export type NewDeepVisitorAlert = typeof deepVisitorAlerts.$inferInsert;

// 메일 링크에서 유입된 고객 여정 카드 — 방문당 한 장, 깊이 알림과 별도 스페이스
// suppressed: CRM 판정은 보존하되 체류 60초 미만·측정 미확인으로 Chat만 발송하지 않음
export const customerJourneyAlerts = pgTable("customer_journey_alerts", {
    id: serial("id").primaryKey(),
    orgId: uuid("org_id").references(() => organizations.id, { onDelete: "cascade" }).notNull(),
    workspaceId: integer("workspace_id").references(() => workspaces.id, { onDelete: "cascade" }).notNull(),
    recordId: integer("record_id").notNull(),
    sessionId: integer("session_id").notNull(),
    lastActivityAt: timestamptz("last_activity_at").notNull(),
    stage: varchar("stage", { length: 100 }).notNull(),
    message: jsonb("message").notNull(),
    status: varchar("status", { length: 20 }).default("pending").notNull(),
    attempts: integer("attempts").default(0).notNull(),
    nextAttemptAt: timestamptz("next_attempt_at").defaultNow().notNull(),
    lastError: text("last_error"),
    createdAt: timestamptz("created_at").defaultNow().notNull(),
    sentAt: timestamptz("sent_at"),
}, (table) => [
    uniqueIndex("cja_org_session_unique").on(table.orgId, table.sessionId),
    index("cja_status_next_idx").on(table.status, table.nextAttemptAt),
]);

// 사업·수신 이메일별 후속 대응. 재방문·중복 CRM 레코드가 있어도 담당자 처리 상태는 유지한다.
export const journeyLeadFollowups = pgTable("journey_lead_followups", {
    id: serial("id").primaryKey(),
    orgId: uuid("org_id").references(() => organizations.id, { onDelete: "cascade" }).notNull(),
    workspaceId: integer("workspace_id").references(() => workspaces.id, { onDelete: "cascade" }).notNull(),
    customerKey: varchar("customer_key", { length: 64 }).notNull(),
    recordId: integer("record_id").notNull(),
    firstUrgentAt: timestamptz("first_urgent_at"),
    status: varchar("status", { length: 20 }).default("new").notNull(),
    dueAt: timestamptz("due_at"),
    note: text("note").default("").notNull(),
    revision: integer("revision").default(0).notNull(),
    updatedBy: uuid("updated_by"),
    updatedByName: varchar("updated_by_name", { length: 100 }),
    createdAt: timestamptz("created_at").defaultNow().notNull(),
    updatedAt: timestamptz("updated_at").defaultNow().notNull(),
    lastRemindedAt: timestamptz("last_reminded_at"),
    nextReminderCheckAt: timestamptz("next_reminder_check_at").defaultNow().notNull(),
    reminderCount: integer("reminder_count").default(0).notNull(),
    reminderResult: varchar("reminder_result", { length: 20 }),
}, (table) => [
    uniqueIndex("jlf_customer_idx").on(table.orgId, table.workspaceId, table.customerKey),
    index("jlf_due_idx").on(table.status, table.dueAt),
]);

// ============================================
// 회신 받기 (Gmail 회신 메일함) — docs/2026-10-11-reply-and-health/DESIGN-RPL.md 9절, 마이그레이션 0074
// ============================================
// 샌드비 발신 주소 앞으로 온 메일만 남는다 (4절 개인정보 거르기). 본문 원문·첨부·Cc 목록은 남기지 않는다 —
// 발췌(인용 뗀 앞 500자)와 분류만. Gmail 메시지 번호는 메일함마다 다르므로 (메일함, 번호)가 유일 키다.
export const emailReplies = pgTable("email_replies", {
    id: serial("id").primaryKey(),
    /** 애매함(ambiguous)이면 NULL */
    orgId: uuid("org_id").references(() => organizations.id, { onDelete: "cascade" }),
    workspaceId: integer("workspace_id"),
    /** 못 이었지만 발신 주소로 사업을 추정했다 (6-3) */
    workspaceGuessed: boolean("workspace_guessed").default(false).notNull(),
    /** 레코드를 지워도 막기 기록은 남긴다. 넣을 때는 records에 있는 것만 (M6) */
    recordId: integer("record_id").references(() => records.id, { onDelete: "set null" }),
    // 발송 기록은 FK를 걸지 않는다 (깊이 알림과 같은 이유 — 큰 표에 잠금을 걸지 않게)
    sendLogId: integer("send_log_id"),
    rootLogId: integer("root_log_id"),
    ruleKind: varchar("rule_kind", { length: 10 }), // ai | template | manual
    ruleId: integer("rule_id"),
    /** 0 = 첫 메일, n = n번째 후속 */
    stepIndex: integer("step_index"),
    mailbox: varchar("mailbox", { length: 200 }).notNull(),
    gmailMessageId: varchar("gmail_message_id", { length: 64 }).notNull(),
    gmailThreadId: varchar("gmail_thread_id", { length: 64 }),
    rfcMessageId: varchar("rfc_message_id", { length: 300 }),
    /** 정규화한 보낸 사람 주소 */
    fromEmail: varchar("from_email", { length: 200 }).notNull(),
    fromName: varchar("from_name", { length: 200 }),
    /** 받은 우리 발신 주소 */
    toEmail: varchar("to_email", { length: 200 }).notNull(),
    /** 사람·자동응답 = 보낸 사람, 반송 = 반송된 받는 주소 (Final → Original) */
    contactEmail: varchar("contact_email", { length: 200 }).notNull(),
    /** 이어진 발송의 받는 주소(원래 받은 사람). 멈춤·막기는 contactEmail과 둘 다 (M3) */
    matchedRecipient: varchar("matched_recipient", { length: 200 }),
    subject: varchar("subject", { length: 300 }),
    /** 인용 뗀 앞 500자. 반송·시스템·큰 메일은 NULL */
    excerpt: text("excerpt"),
    kind: varchar("kind", { length: 20 }).notNull(), // human | auto_reply | bounce | system | internal | unknown
    bounceType: varchar("bounce_type", { length: 10 }), // hard | expired | soft | unknown
    dsnStatus: varchar("dsn_status", { length: 20 }),
    dsnDiagnostic: varchar("dsn_diagnostic", { length: 300 }),
    unsubscribeHint: boolean("unsubscribe_hint").default(false).notNull(),
    oursReason: varchar("ours_reason", { length: 20 }).notNull(), // address | domain_thread
    matchStatus: varchar("match_status", { length: 20 }).notNull(), // matched | unmatched | ambiguous
    matchMethod: varchar("match_method", { length: 20 }),
    /** Gmail internalDate */
    receivedAt: timestamptz("received_at").notNull(),
    detectedAt: timestamptz("detected_at").defaultNow().notNull(),
    detectedMode: varchar("detected_mode", { length: 10 }).notNull(), // dry_run | on
    /** 메일 하나의 데이터 오류 (SQLSTATE·제약 이름만, M6) */
    processError: varchar("process_error", { length: 80 }),
    effectsAppliedAt: timestamptz("effects_applied_at"),
    /** 효과를 적용할 때의 kind — 사람으로 고치면 다시 적용 (M5) */
    effectsAppliedKind: varchar("effects_applied_kind", { length: 20 }),
    effects: jsonb("effects").$type<Record<string, unknown>>(),
    /** 담당이 끄면 보내기 직전 막기에서 빠진다 */
    stopAutomation: boolean("stop_automation").default(true).notNull(),
    alertStatus: varchar("alert_status", { length: 20 }), // NULL | pending | processing | sent | failed | skipped | dry_run
    alertAttempts: integer("alert_attempts").default(0).notNull(),
    alertNextAt: timestamptz("alert_next_at"),
    alertLockedAt: timestamptz("alert_locked_at"),
    alertMessage: text("alert_message"),
    alertLastError: text("alert_last_error"),
    alertSentAt: timestamptz("alert_sent_at"),
    handledBy: uuid("handled_by"),
    handledAt: timestamptz("handled_at"),
    kindChangedBy: uuid("kind_changed_by"),
    kindChangedAt: timestamptz("kind_changed_at"),
}, (table) => [
    uniqueIndex("er_mailbox_gmail_idx").on(table.mailbox, table.gmailMessageId),
    uniqueIndex("er_org_rfc_idx")
        .on(table.orgId, table.rfcMessageId)
        .where(sql`"org_id" IS NOT NULL AND "rfc_message_id" IS NOT NULL`),
    index("er_stop_idx").on(table.workspaceId, table.contactEmail),
    index("er_stop_recipient_idx").on(table.workspaceId, table.matchedRecipient).where(sql`"matched_recipient" IS NOT NULL`),
    index("er_send_log_idx").on(table.sendLogId),
    index("er_record_idx").on(table.recordId),
    index("er_org_received_idx").on(table.orgId, table.receivedAt),
    index("er_alert_pickup_idx").on(table.alertStatus, table.alertNextAt, table.id),
]);

export type EmailReply = typeof emailReplies.$inferSelect;
export type NewEmailReply = typeof emailReplies.$inferInsert;

/** 메일함마다 어디까지 읽었나. 남의 메일에 대해서는 건수(stats)만 남는다 */
export const emailReplyMailboxState = pgTable("email_reply_mailbox_state", {
    mailbox: varchar("mailbox", { length: 200 }).primaryKey(),
    historyId: varchar("history_id", { length: 32 }),
    backfillAfter: timestamptz("backfill_after"),
    backfillBefore: timestamptz("backfill_before"),
    backfillDoneAt: timestamptz("backfill_done_at"),
    lastRunAt: timestamptz("last_run_at"),
    lastSuccessAt: timestamptz("last_success_at"),
    /** auth | scope | mailbox_mismatch | rate_limited | transient | config | stale */
    lastErrorCode: varchar("last_error_code", { length: 30 }),
    /** 한국어 한 줄. 비밀값·주소 없음 */
    lastError: text("last_error"),
    lastErrorAt: timestamptz("last_error_at"),
    opsAlertedAt: timestamptz("ops_alerted_at"),
    /** 마지막으로 운영 알림을 보낸 원인 (같은 원인은 6시간에 한 번, 원인이 바뀌면 바로 — RO-7) */
    opsAlertedCode: varchar("ops_alerted_code", { length: 30 }),
    /** 회복 글을 아직 못 보냈다 (그 원인) — 다음 성공 회차에 다시 보낸다 (RO-6) */
    opsRecoveryCode: varchar("ops_recovery_code", { length: 30 }),
    /** 마지막으로 회복한 때 — 1시간 안에 같은 문제가 다시 나면 바로 알리지 않는다 (RO-15) */
    opsRecoveredAt: timestamptz("ops_recovered_at"),
    /** 마지막 회차와 오늘(KST) 누적 숫자 + excluded(뺀 주소, 가린 모양)·serverKind */
    stats: jsonb("stats").$type<Record<string, unknown>>(),
    updatedAt: timestamptz("updated_at").defaultNow().notNull(),
});

export type EmailReplyMailboxState = typeof emailReplyMailboxState.$inferSelect;

// ============================================
// 발신 건강 (0075, docs/2026-10-11-reply-and-health/DESIGN-SND.md 8절)
// ============================================

/** 명단 보류. 풀어도 줄을 남긴다 (언제·왜·누가 풀었나). 명단 하나에 풀리지 않은 보류는 하나뿐이다 */
export const emailPartitionHolds = pgTable("email_partition_holds", {
    id: serial("id").primaryKey(),
    orgId: uuid("org_id")
        .references(() => organizations.id, { onDelete: "cascade" })
        .notNull(),
    workspaceId: integer("workspace_id").notNull(),
    partitionId: integer("partition_id")
        .references(() => partitions.id, { onDelete: "cascade" })
        .notNull(),
    /** bulk(대량만, 자동 보류는 늘 이것) | all(나중의 손 보류) */
    scope: varchar("scope", { length: 8 }).default("bulk").notNull(),
    /** auto | manual(나중) */
    source: varchar("source", { length: 10 }).default("auto").notNull(),
    reasonCode: varchar("reason_code", { length: 30 }).notNull(),
    /** 사람이 읽는 한 줄 (받는 주소 없음) */
    reasonText: text("reason_text").notNull(),
    metrics: jsonb("metrics").$type<Record<string, unknown>>(),
    eventId: integer("event_id"),
    heldAt: timestamptz("held_at").defaultNow().notNull(),
    releasedAt: timestamptz("released_at"),
    releasedBy: uuid("released_by"),
    releaseNote: text("release_note"),
}, (table) => [
    uniqueIndex("eph_active_partition_idx").on(table.partitionId).where(sql`"released_at" IS NULL`),
    index("eph_org_held_idx").on(table.orgId, table.heldAt),
    index("eph_partition_released_idx").on(table.partitionId, table.releasedAt),
]);

export type EmailPartitionHold = typeof emailPartitionHolds.$inferSelect;

/** 반송 안내·스팸 신고 신호 (회신 읽기가 넘겨준 것, DESIGN-SND 4절). send_log_id는 FK 없음 — 큰 표에 잠금을 걸지 않게 */
export const emailBounceSignals = pgTable("email_bounce_signals", {
    id: serial("id").primaryKey(),
    orgId: uuid("org_id")
        .references(() => organizations.id, { onDelete: "cascade" })
        .notNull(),
    sendLogId: integer("send_log_id"),
    recordId: integer("record_id"),
    /** 소문자. Final-Recipient(없으면 Original). complaint는 이어진 발송의 받는 주소 */
    recipientEmail: varchar("recipient_email", { length: 200 }).notNull(),
    originalRecipient: varchar("original_recipient", { length: 200 }),
    /** 소문자, 우리 발신 주소 */
    senderEmail: varchar("sender_email", { length: 200 }).notNull(),
    dsnAction: varchar("dsn_action", { length: 16 }),
    dsnStatus: varchar("dsn_status", { length: 16 }),
    /** 앞 300자 */
    diagnostic: text("diagnostic"),
    /** hard | expired | soft | unknown | complaint */
    kind: varchar("kind", { length: 10 }).notNull(),
    /** same | different | NULL(못 이음) */
    recipientMatch: varchar("recipient_match", { length: 10 }),
    /** recipient | sender */
    failSide: varchar("fail_side", { length: 10 }),
    gmailMessageId: varchar("gmail_message_id", { length: 64 }).notNull(),
    receivedAt: timestamptz("received_at").notNull(),
    /** 발송 기록에 적용한 때. RPL dry_run이면 NULL (뒤에 applyPendingBounceSignals) */
    appliedAt: timestamptz("applied_at"),
    /** 이 신호로 발송 기록이 처음 실패가 됐나 */
    counted: boolean("counted").default(false).notNull(),
    createdAt: timestamptz("created_at").defaultNow().notNull(),
}, (table) => [
    uniqueIndex("ebs_message_recipient_idx").on(table.orgId, table.gmailMessageId, table.recipientEmail),
    index("ebs_org_received_idx").on(table.orgId, table.receivedAt),
    index("ebs_org_recipient_idx").on(table.orgId, table.recipientEmail).where(sql`"kind" = 'hard'`),
]);

export type EmailBounceSignal = typeof emailBounceSignals.$inferSelect;

/** 건강 사건 (감사 기록). dedupe_key가 조직 안에서 유일하다 (DESIGN-SND 7-1) */
export const emailHealthEvents = pgTable("email_health_events", {
    id: serial("id").primaryKey(),
    orgId: uuid("org_id")
        .references(() => organizations.id, { onDelete: "cascade" })
        .notNull(),
    workspaceId: integer("workspace_id"),
    /** partition | sender | domain | org */
    entityType: varchar("entity_type", { length: 10 }).notNull(),
    /** 파티션 id·프로필 id (0 = 프로필 없는 기본 주소) */
    entityId: integer("entity_id"),
    /** 도메인 사건이면 도메인 */
    entityKey: varchar("entity_key", { length: 220 }),
    /** danger | danger_with | auth_burst | release | report | cap | sync */
    kind: varchar("kind", { length: 12 }).notNull(),
    /** danger | caution | info */
    level: varchar("level", { length: 8 }).notNull(),
    /** dry_run | alert | enforce */
    mode: varchar("mode", { length: 8 }).notNull(),
    /** none | hold | pause | release */
    action: varchar("action", { length: 8 }).default("none").notNull(),
    /** mode | opt_out | cap | cap_auth | no_profile | already | default_sender | sync_stale | sync_initial | unconfirmed_high */
    actionNote: varchar("action_note", { length: 20 }),
    /** 7d | 30d */
    evalWindow: varchar("eval_window", { length: 4 }),
    dedupeKey: varchar("dedupe_key", { length: 200 }).notNull(),
    metrics: jsonb("metrics").$type<Record<string, unknown>>(),
    summary: text("summary").notNull(),
    actorUserId: uuid("actor_user_id"),
    createdAt: timestamptz("created_at").defaultNow().notNull(),
}, (table) => [
    uniqueIndex("ehe_org_dedupe_idx").on(table.orgId, table.dedupeKey),
    index("ehe_org_created_idx").on(table.orgId, table.createdAt),
]);

export type EmailHealthEvent = typeof emailHealthEvents.$inferSelect;

/** 알림 보낼 줄 — 한 회차의 새 사건을 조직·받는 곳마다 한 통으로 묶는다 (SND-13) */
export const emailHealthAlerts = pgTable("email_health_alerts", {
    id: serial("id").primaryKey(),
    orgId: uuid("org_id").notNull(),
    /** run:<회차 시작 ms> | report:<날짜> | release:<…> | sync:<…> */
    batchKey: varchar("batch_key", { length: 80 }).notNull(),
    eventIds: integer("event_ids").array().notNull(),
    /** ops | ws:<워크스페이스 id> */
    target: varchar("target", { length: 20 }).notNull(),
    workspaceId: integer("workspace_id"),
    message: text("message").notNull(),
    /** pending | processing | sent | failed | skipped | dry_run */
    status: varchar("status", { length: 12 }).default("pending").notNull(),
    attempts: integer("attempts").default(0).notNull(),
    lastError: text("last_error"),
    scheduledAt: timestamptz("scheduled_at").defaultNow().notNull(),
    lockedAt: timestamptz("locked_at"),
    sentAt: timestamptz("sent_at"),
    createdAt: timestamptz("created_at").defaultNow().notNull(),
}, (table) => [
    uniqueIndex("eha_org_batch_target_idx").on(table.orgId, table.batchKey, table.target),
    index("eha_pickup_idx").on(table.status, table.scheduledAt, table.id),
]);

export type EmailHealthAlert = typeof emailHealthAlerts.$inferSelect;

/** 하루 건강 (대상별, 회차마다 오늘 줄을 덮어쓴다 — 날짜별로 남는다) */
export const emailHealthDaily = pgTable("email_health_daily", {
    orgId: uuid("org_id")
        .references(() => organizations.id, { onDelete: "cascade" })
        .notNull(),
    /** KST "YYYY-MM-DD" */
    healthDate: varchar("health_date", { length: 10 }).notNull(),
    /** p:<id> | s:<id> | s:0 | d:<도메인> */
    entityKey: varchar("entity_key", { length: 220 }).notNull(),
    workspaceId: integer("workspace_id"),
    finalCount: integer("final_count").default(0).notNull(),
    failedCount: integer("failed_count").default(0).notNull(),
    senderSideCount: integer("sender_side_count").default(0).notNull(),
    nhnUnsubCount: integer("nhn_unsub_count").default(0).notNull(),
    unknownCount: integer("unknown_count").default(0).notNull(),
    dsnOnlyCount: integer("dsn_only_count").default(0).notNull(),
    rateBp: integer("rate_bp"),
    /** ok | caution | danger | insufficient */
    state: varchar("state", { length: 12 }).notNull(),
    /** 7d | 30d (느린 명단) */
    evalWindow: varchar("eval_window", { length: 4 }).default("7d").notNull(),
    reasons: jsonb("reasons").$type<Record<string, unknown>>(),
    windowStart: timestamptz("window_start").notNull(),
    evaluatedAt: timestamptz("evaluated_at").defaultNow().notNull(),
}, (table) => [
    // 이름을 마이그레이션 SQL의 기본 이름과 맞춘다 — 다르면 drizzle-kit이 PK를 다시 만들려 한다
    primaryKey({ name: "email_health_daily_pkey", columns: [table.orgId, table.healthDate, table.entityKey] }),
]);

export type EmailHealthDailyRow = typeof emailHealthDaily.$inferSelect;

/** NHN 결과 동기화 상태 (조직마다 한 줄. 같은 appKey 묶음은 대표 조직 줄의 커서를 따른다, DESIGN-SND 3-2) */
export const emailStatusSyncState = pgTable("email_status_sync_state", {
    orgId: uuid("org_id")
        .primaryKey()
        .references(() => organizations.id, { onDelete: "cascade" }),
    /** update-mails를 여기까지 다 읽었다 */
    updateCursor: timestamptz("update_cursor"),
    /** 처음 커서 (now − 8일) */
    initialFrom: timestamptz("initial_from"),
    /** 커서가 지금을 따라잡은 때. 비면 6-1 관문 */
    initialDoneAt: timestamptz("initial_done_at"),
    lastRunAt: timestamptz("last_run_at"),
    lastOkAt: timestamptz("last_ok_at"),
    lastError: text("last_error"),
    /** auth | rate_limited | transient | config */
    lastErrorCode: varchar("last_error_code", { length: 20 }),
    consecutiveErrors: integer("consecutive_errors").default(0).notNull(),
    /** 운영 알림 6시간 간격 */
    opsAlertedAt: timestamptz("ops_alerted_at"),
    /** 마지막으로 알린 원인 (auth | stale) — 같은 원인은 마지막 알림 6시간 뒤에 다시 (HS-1·HS-6) */
    opsAlertedCause: varchar("ops_alerted_cause", { length: 12 }),
    /** 마지막 회차 숫자: calls·windows·updated·unpaired·fallbackCalls·skippedWindows */
    stats: jsonb("stats").$type<Record<string, unknown>>(),
    updatedAt: timestamptz("updated_at").defaultNow().notNull(),
});

export type EmailStatusSyncState = typeof emailStatusSyncState.$inferSelect;

/**
 * 구글 챗 웹훅(받는 곳)마다 전달 상태 (구글 챗 QA WPN-1~5). 웹훅을 정하는 환경 변수 이름 하나가 한 줄 — 주소(비밀값)는 넣지 않는다.
 * 깊이·회신·발송 건강·운영 알림이 함께 쓰고, 문제가 생기면 운영 스페이스에 6시간에 한 번, 고쳐지면 한 번 알린다
 */
export const chatWebhookStatus = pgTable("chat_webhook_status", {
    /** DEEP_ALERT_WEBHOOK_URL_7 · SEND_HEALTH_WEBHOOK_URL · REPLY_OPS_WEBHOOK_URL … */
    source: varchar("source", { length: 80 }).primaryKey(),
    workspaceId: integer("workspace_id"),
    /** config(401·403·404) | missing | invalid | unreachable | null(정상) */
    kind: varchar("kind", { length: 12 }),
    lastStatus: integer("last_status"),
    /** 한국어 한 줄 (주소·key·token 없음) */
    lastError: text("last_error"),
    problemSince: timestamptz("problem_since"),
    lastOkAt: timestamptz("last_ok_at"),
    lastFailAt: timestamptz("last_fail_at"),
    opsAlertedAt: timestamptz("ops_alerted_at"),
    opsAlertedKind: varchar("ops_alerted_kind", { length: 12 }),
    /** 문제가 난 주소의 지문 (sha256 앞 16자) — 주소를 바꾸면 고장 표시를 믿지 않는다 */
    urlHash: varchar("url_hash", { length: 16 }),
    updatedAt: timestamptz("updated_at").defaultNow().notNull(),
});

export type ChatWebhookStatus = typeof chatWebhookStatus.$inferSelect;
