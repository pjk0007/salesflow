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
        createdAt: timestamptz("created_at").defaultNow().notNull(),
        updatedAt: timestamptz("updated_at").defaultNow().notNull(),
    },
    (table) => ({
        orgEmailUnique: unique().on(table.orgId, table.email),
    })
);

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
    settings: jsonb("settings").$type<{
        defaultVisibleFields?: string[];
        duplicateCheckField?: string;
    }>(),
    createdAt: timestamptz("created_at").defaultNow().notNull(),
    updatedAt: timestamptz("updated_at").defaultNow().notNull(),
});

// ============================================
// 필드 정의 (워크스페이스별 커스텀 필드)
// ============================================
export const fieldDefinitions = pgTable(
    "field_definitions",
    {
        id: serial("id").primaryKey(),
        workspaceId: integer("workspace_id")
            .references(() => workspaces.id, { onDelete: "cascade" })
            .notNull(),
        key: varchar("key", { length: 100 }).notNull(),
        label: varchar("label", { length: 200 }).notNull(),
        fieldType: varchar("field_type", { length: 30 }).notNull(), // text|number|date|select|phone|...
        category: varchar("category", { length: 100 }),
        sortOrder: integer("sort_order").default(0).notNull(),
        isRequired: integer("is_required").default(0).notNull(),
        isSystem: integer("is_system").default(0).notNull(),
        // 표시 설정
        defaultWidth: integer("default_width").default(120).notNull(),
        minWidth: integer("min_width").default(80).notNull(),
        cellType: varchar("cell_type", { length: 30 }),
        cellClassName: varchar("cell_class_name", { length: 100 }),
        // Select/Status 옵션
        options: jsonb("options").$type<string[]>(),
        statusOptionCategoryId: integer("status_option_category_id"),
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
    isActive: integer("is_active").default(1).notNull(),
    createdBy: uuid("created_by").references(() => users.id),
    createdAt: timestamptz("created_at").defaultNow().notNull(),
    updatedAt: timestamptz("updated_at").defaultNow().notNull(),
});

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
    requestId: varchar("request_id", { length: 100 }),
    status: varchar("status", { length: 20 }).default("pending").notNull(),
    resultCode: varchar("result_code", { length: 20 }),
    resultMessage: text("result_message"),
    triggerType: varchar("trigger_type", { length: 30 }),
    sentBy: uuid("sent_by").references(() => users.id),
    sentAt: timestamptz("sent_at").defaultNow().notNull(),
    completedAt: timestamptz("completed_at"),
});

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
    provider: varchar("provider", { length: 50 }).notNull(), // "openai" | "anthropic"
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
// 대시보드
// ============================================
export const dashboards = pgTable("dashboards", {
    id: serial("id").primaryKey(),
    orgId: uuid("org_id")
        .references(() => organizations.id, { onDelete: "cascade" })
        .notNull(),
    workspaceId: integer("workspace_id")
        .references(() => workspaces.id, { onDelete: "cascade" })
        .notNull(),
    name: varchar("name", { length: 200 }).notNull(),
    slug: varchar("slug", { length: 100 }).unique().notNull(),
    description: text("description"),
    partitionIds: jsonb("partition_ids").$type<number[]>(),
    globalFilters: jsonb("global_filters").$type<DashboardFilter[]>(),
    refreshInterval: integer("refresh_interval").default(60).notNull(),
    isPublic: integer("is_public").default(0).notNull(),
    createdBy: uuid("created_by").references(() => users.id),
    createdAt: timestamptz("created_at").defaultNow().notNull(),
    updatedAt: timestamptz("updated_at").defaultNow().notNull(),
});

export const dashboardWidgets = pgTable("dashboard_widgets", {
    id: serial("id").primaryKey(),
    dashboardId: integer("dashboard_id")
        .references(() => dashboards.id, { onDelete: "cascade" })
        .notNull(),
    title: varchar("title", { length: 200 }).notNull(),
    widgetType: varchar("widget_type", { length: 20 }).notNull(),
    dataColumn: varchar("data_column", { length: 100 }).notNull(),
    aggregation: varchar("aggregation", { length: 20 }).default("count").notNull(),
    groupByColumn: varchar("group_by_column", { length: 100 }),
    stackByColumn: varchar("stack_by_column", { length: 100 }),
    widgetFilters: jsonb("widget_filters").$type<DashboardFilter[]>(),
    layoutX: integer("layout_x").default(0).notNull(),
    layoutY: integer("layout_y").default(0).notNull(),
    layoutW: integer("layout_w").default(4).notNull(),
    layoutH: integer("layout_h").default(3).notNull(),
    createdAt: timestamptz("created_at").defaultNow().notNull(),
    updatedAt: timestamptz("updated_at").defaultNow().notNull(),
});

export interface DashboardFilter {
    field: string;
    operator: "eq" | "ne" | "gt" | "gte" | "lt" | "lte" | "like" | "in" | "date_preset";
    value: string;
}

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
export type Product = typeof products.$inferSelect;
export type NewProduct = typeof products.$inferInsert;
export type AiConfig = typeof aiConfigs.$inferSelect;
export type AiUsageLog = typeof aiUsageLogs.$inferSelect;
export type OrganizationInvitation = typeof organizationInvitations.$inferSelect;
export type NewOrganizationInvitation = typeof organizationInvitations.$inferInsert;
export type OrganizationMember = typeof organizationMembers.$inferSelect;
export type NewOrganizationMember = typeof organizationMembers.$inferInsert;
export type WebForm = typeof webForms.$inferSelect;
export type NewWebForm = typeof webForms.$inferInsert;
export type WebFormField = typeof webFormFields.$inferSelect;
export type NewWebFormField = typeof webFormFields.$inferInsert;
export type Dashboard = typeof dashboards.$inferSelect;
export type NewDashboard = typeof dashboards.$inferInsert;
export type DashboardWidget = typeof dashboardWidgets.$inferSelect;
export type NewDashboardWidget = typeof dashboardWidgets.$inferInsert;
export type Plan = typeof plans.$inferSelect;
export type Subscription = typeof subscriptions.$inferSelect;
export type Payment = typeof payments.$inferSelect;
