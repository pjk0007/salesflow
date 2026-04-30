import {
    pgTable,
    serial,
    uuid,
    varchar,
    text,
    integer,
    boolean,
    timestamp,
    unique,
    jsonb,
    index,
    uniqueIndex,
} from "drizzle-orm/pg-core";
import type { FormulaConfig } from "@/types";

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
    createdAt: timestamptz("created_at").defaultNow().notNull(),
    updatedAt: timestamptz("updated_at").defaultNow().notNull(),
});

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
        onOpened?: { templateId: number };
        onNotOpened?: { templateId: number };
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
    isOpened: integer("is_opened").default(0).notNull(),
    openedAt: timestamptz("opened_at"),
    parentLogId: integer("parent_log_id"),
    autoPersonalizedLinkId: integer("auto_personalized_link_id").references(
        () => emailAutoPersonalizedLinks.id,
        { onDelete: "set null" }
    ),
});

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
}, (table) => [
    index("email_click_logs_send_log_idx").on(table.sendLogId),
]);

export type EmailClickLog = typeof emailClickLogs.$inferSelect;

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
        status: varchar("status", { length: 20 }).default("pending").notNull(),
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
    prompt: text("prompt"),
    tone: varchar("tone", { length: 50 }),
    format: varchar("format", { length: 20 }).default("plain").notNull(),
    triggerType: varchar("trigger_type", { length: 20 }).default("on_create").notNull(),
    triggerCondition: jsonb("trigger_condition").$type<{
        field?: string;
        operator?: "eq" | "ne" | "contains";
        value?: string;
    }>(),
    autoResearch: integer("auto_research").default(1).notNull(),
    useSignaturePersona: integer("use_signature_persona").default(0).notNull(),
    followupConfig: jsonb("followup_config").$type<{
        delayDays: number;
        onOpened?: { prompt: string };
        onNotOpened?: { prompt: string };
    } | null>(),
    senderProfileId: integer("sender_profile_id"),
    signatureId: integer("signature_id"),
    preventDuplicate: integer("prevent_duplicate").default(0).notNull(),
    isActive: integer("is_active").default(1).notNull(),
    isDraft: integer("is_draft").default(0).notNull(),
    createdAt: timestamptz("created_at").defaultNow().notNull(),
    updatedAt: timestamptz("updated_at").defaultNow().notNull(),
});

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
        status: varchar("status", { length: 20 }).default("pending").notNull(),
        result: varchar("result", { length: 20 }),
        processedAt: timestamptz("processed_at"),
        createdAt: timestamptz("created_at").defaultNow().notNull(),
    },
    (table) => ({
        statusCheckIdx: index("efq_status_check_idx").on(table.status, table.checkAt),
        parentLogStepIdx: uniqueIndex("efq_parent_log_step_idx").on(table.parentLogId, table.stepIndex),
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
    totalTokens: integer("total_tokens").default(0).notNull(),
    quotaLimit: integer("quota_limit").default(100000).notNull(),
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
    createdAt: timestamptz("created_at").defaultNow().notNull(),
    updatedAt: timestamptz("updated_at").defaultNow().notNull(),
});

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
export type EmailAutoPersonalizedLink = typeof emailAutoPersonalizedLinks.$inferSelect;
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
export type EmailSignature = typeof emailSignatures.$inferSelect;
export type AdPlatform = typeof adPlatforms.$inferSelect;
export type NewAdPlatform = typeof adPlatforms.$inferInsert;
export type AdAccount = typeof adAccounts.$inferSelect;
export type NewAdAccount = typeof adAccounts.$inferInsert;
export type AdLeadIntegration = typeof adLeadIntegrations.$inferSelect;
export type NewAdLeadIntegration = typeof adLeadIntegrations.$inferInsert;
export type AdLeadLog = typeof adLeadLogs.$inferSelect;
export type NewAdLeadLog = typeof adLeadLogs.$inferInsert;
