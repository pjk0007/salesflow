import { pgTable, foreignKey, unique, serial, uuid, varchar, timestamp, integer, text, jsonb, index } from "drizzle-orm/pg-core"
import { sql } from "drizzle-orm"



export const apiTokens = pgTable("api_tokens", {
	id: serial().primaryKey().notNull(),
	orgId: uuid("org_id").notNull(),
	name: varchar({ length: 100 }).notNull(),
	token: varchar({ length: 64 }).notNull(),
	createdBy: uuid("created_by").notNull(),
	lastUsedAt: timestamp("last_used_at", { withTimezone: true, mode: 'string' }),
	expiresAt: timestamp("expires_at", { withTimezone: true, mode: 'string' }),
	isActive: integer("is_active").default(1).notNull(),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	foreignKey({
			columns: [table.orgId],
			foreignColumns: [organizations.id],
			name: "api_tokens_org_id_organizations_id_fk"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.createdBy],
			foreignColumns: [users.id],
			name: "api_tokens_created_by_users_id_fk"
		}),
	unique("api_tokens_token_unique").on(table.token),
]);

export const emailConfigs = pgTable("email_configs", {
	id: serial().primaryKey().notNull(),
	orgId: uuid("org_id").notNull(),
	provider: varchar({ length: 20 }).default('smtp').notNull(),
	smtpHost: varchar("smtp_host", { length: 200 }),
	smtpPort: integer("smtp_port"),
	smtpUser: varchar("smtp_user", { length: 200 }),
	smtpPass: varchar("smtp_pass", { length: 200 }),
	fromName: varchar("from_name", { length: 100 }),
	fromEmail: varchar("from_email", { length: 200 }),
	isActive: integer("is_active").default(1).notNull(),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	foreignKey({
			columns: [table.orgId],
			foreignColumns: [organizations.id],
			name: "email_configs_org_id_organizations_id_fk"
		}).onDelete("cascade"),
	unique("email_configs_org_id_unique").on(table.orgId),
]);

export const emailTemplates = pgTable("email_templates", {
	id: serial().primaryKey().notNull(),
	orgId: uuid("org_id").notNull(),
	name: varchar({ length: 200 }).notNull(),
	subject: varchar({ length: 500 }).notNull(),
	htmlBody: text("html_body").notNull(),
	templateType: varchar("template_type", { length: 50 }),
	isActive: integer("is_active").default(1).notNull(),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	foreignKey({
			columns: [table.orgId],
			foreignColumns: [organizations.id],
			name: "email_templates_org_id_organizations_id_fk"
		}).onDelete("cascade"),
]);

export const fieldDefinitions = pgTable("field_definitions", {
	id: serial().primaryKey().notNull(),
	workspaceId: integer("workspace_id").notNull(),
	key: varchar({ length: 100 }).notNull(),
	label: varchar({ length: 200 }).notNull(),
	fieldType: varchar("field_type", { length: 30 }).notNull(),
	category: varchar({ length: 100 }),
	sortOrder: integer("sort_order").default(0).notNull(),
	isRequired: integer("is_required").default(0).notNull(),
	isSystem: integer("is_system").default(0).notNull(),
	defaultWidth: integer("default_width").default(120).notNull(),
	minWidth: integer("min_width").default(80).notNull(),
	cellType: varchar("cell_type", { length: 30 }),
	cellClassName: varchar("cell_class_name", { length: 100 }),
	options: jsonb(),
	statusOptionCategoryId: integer("status_option_category_id"),
	formulaConfig: jsonb("formula_config"),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	foreignKey({
			columns: [table.workspaceId],
			foreignColumns: [workspaces.id],
			name: "field_definitions_workspace_id_workspaces_id_fk"
		}).onDelete("cascade"),
	unique("field_definitions_workspace_id_key_unique").on(table.workspaceId, table.key),
]);

export const folders = pgTable("folders", {
	id: serial().primaryKey().notNull(),
	workspaceId: integer("workspace_id").notNull(),
	name: varchar({ length: 100 }).notNull(),
	displayOrder: integer("display_order").default(0).notNull(),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	foreignKey({
			columns: [table.workspaceId],
			foreignColumns: [workspaces.id],
			name: "folders_workspace_id_workspaces_id_fk"
		}).onDelete("cascade"),
]);

export const alimtalkConfigs = pgTable("alimtalk_configs", {
	id: serial().primaryKey().notNull(),
	orgId: uuid("org_id").notNull(),
	appKey: varchar("app_key", { length: 200 }).notNull(),
	secretKey: varchar("secret_key", { length: 200 }).notNull(),
	defaultSenderKey: varchar("default_sender_key", { length: 200 }),
	isActive: integer("is_active").default(1).notNull(),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	foreignKey({
			columns: [table.orgId],
			foreignColumns: [organizations.id],
			name: "alimtalk_configs_org_id_organizations_id_fk"
		}).onDelete("cascade"),
	unique("alimtalk_configs_org_id_unique").on(table.orgId),
]);

export const alimtalkTemplateLinks = pgTable("alimtalk_template_links", {
	id: serial().primaryKey().notNull(),
	partitionId: integer("partition_id").notNull(),
	name: varchar({ length: 100 }).notNull(),
	senderKey: varchar("sender_key", { length: 100 }).notNull(),
	templateCode: varchar("template_code", { length: 100 }).notNull(),
	templateName: varchar("template_name", { length: 200 }),
	triggerType: varchar("trigger_type", { length: 30 }).default('manual').notNull(),
	triggerCondition: jsonb("trigger_condition"),
	recipientField: varchar("recipient_field", { length: 100 }).notNull(),
	variableMappings: jsonb("variable_mappings"),
	isActive: integer("is_active").default(1).notNull(),
	createdBy: uuid("created_by"),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	repeatConfig: jsonb("repeat_config"),
}, (table) => [
	foreignKey({
			columns: [table.partitionId],
			foreignColumns: [partitions.id],
			name: "alimtalk_template_links_partition_id_partitions_id_fk"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.createdBy],
			foreignColumns: [users.id],
			name: "alimtalk_template_links_created_by_users_id_fk"
		}),
]);

export const memos = pgTable("memos", {
	id: serial().primaryKey().notNull(),
	recordId: integer("record_id").notNull(),
	content: text().notNull(),
	createdBy: uuid("created_by"),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	foreignKey({
			columns: [table.recordId],
			foreignColumns: [records.id],
			name: "memos_record_id_records_id_fk"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.createdBy],
			foreignColumns: [users.id],
			name: "memos_created_by_users_id_fk"
		}),
]);

export const organizations = pgTable("organizations", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	name: varchar({ length: 200 }).notNull(),
	slug: varchar({ length: 100 }).notNull(),
	branding: jsonb(),
	integratedCodePrefix: varchar("integrated_code_prefix", { length: 20 }).default('SALES').notNull(),
	integratedCodeSeq: integer("integrated_code_seq").default(0).notNull(),
	settings: jsonb(),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	unique("organizations_slug_unique").on(table.slug),
]);

export const partitionPermissions = pgTable("partition_permissions", {
	id: serial().primaryKey().notNull(),
	partitionId: integer("partition_id").notNull(),
	userId: uuid("user_id").notNull(),
	permissionType: varchar("permission_type", { length: 20 }).notNull(),
	grantedBy: uuid("granted_by"),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	foreignKey({
			columns: [table.partitionId],
			foreignColumns: [partitions.id],
			name: "partition_permissions_partition_id_partitions_id_fk"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.userId],
			foreignColumns: [users.id],
			name: "partition_permissions_user_id_users_id_fk"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.grantedBy],
			foreignColumns: [users.id],
			name: "partition_permissions_granted_by_users_id_fk"
		}),
	unique("partition_permissions_partition_id_user_id_unique").on(table.partitionId, table.userId),
]);

export const statusOptionCategories = pgTable("status_option_categories", {
	id: serial().primaryKey().notNull(),
	workspaceId: integer("workspace_id").notNull(),
	key: varchar({ length: 50 }).notNull(),
	label: varchar({ length: 100 }).notNull(),
	sortOrder: integer("sort_order").default(0).notNull(),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	foreignKey({
			columns: [table.workspaceId],
			foreignColumns: [workspaces.id],
			name: "status_option_categories_workspace_id_workspaces_id_fk"
		}).onDelete("cascade"),
	unique("status_option_categories_workspace_id_key_unique").on(table.workspaceId, table.key),
]);

export const partitions = pgTable("partitions", {
	id: serial().primaryKey().notNull(),
	workspaceId: integer("workspace_id").notNull(),
	name: varchar({ length: 100 }).notNull(),
	folderId: integer("folder_id"),
	displayOrder: integer("display_order").default(0).notNull(),
	visibleFields: jsonb("visible_fields"),
	useDistributionOrder: integer("use_distribution_order").default(0).notNull(),
	maxDistributionOrder: integer("max_distribution_order").default(5).notNull(),
	lastAssignedOrder: integer("last_assigned_order").default(0).notNull(),
	distributionDefaults: jsonb("distribution_defaults"),
	duplicateCheckField: varchar("duplicate_check_field", { length: 100 }),
	statusOptionIds: jsonb("status_option_ids"),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	foreignKey({
			columns: [table.workspaceId],
			foreignColumns: [workspaces.id],
			name: "partitions_workspace_id_workspaces_id_fk"
		}).onDelete("cascade"),
]);

export const records = pgTable("records", {
	id: serial().primaryKey().notNull(),
	orgId: uuid("org_id").notNull(),
	workspaceId: integer("workspace_id").notNull(),
	partitionId: integer("partition_id").notNull(),
	integratedCode: varchar("integrated_code", { length: 50 }),
	distributionOrder: integer("distribution_order"),
	data: jsonb().default({}).notNull(),
	registeredAt: timestamp("registered_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	index("records_org_idx").using("btree", table.orgId.asc().nullsLast().op("uuid_ops")),
	index("records_partition_idx").using("btree", table.partitionId.asc().nullsLast().op("int4_ops")),
	index("records_workspace_idx").using("btree", table.workspaceId.asc().nullsLast().op("int4_ops")),
	foreignKey({
			columns: [table.partitionId],
			foreignColumns: [partitions.id],
			name: "records_partition_id_partitions_id_fk"
		}).onDelete("cascade"),
]);

export const statusOptions = pgTable("status_options", {
	id: serial().primaryKey().notNull(),
	categoryId: integer("category_id").notNull(),
	value: varchar({ length: 100 }).notNull(),
	label: varchar({ length: 100 }).notNull(),
	bgColor: varchar("bg_color", { length: 30 }),
	sortOrder: integer("sort_order").default(0).notNull(),
	isActive: integer("is_active").default(1).notNull(),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	foreignKey({
			columns: [table.categoryId],
			foreignColumns: [statusOptionCategories.id],
			name: "status_options_category_id_status_option_categories_id_fk"
		}).onDelete("cascade"),
	unique("status_options_category_id_value_unique").on(table.categoryId, table.value),
]);

export const alimtalkSendLogs = pgTable("alimtalk_send_logs", {
	id: serial().primaryKey().notNull(),
	orgId: uuid("org_id").notNull(),
	templateLinkId: integer("template_link_id"),
	partitionId: integer("partition_id"),
	recordId: integer("record_id"),
	senderKey: varchar("sender_key", { length: 100 }).notNull(),
	templateCode: varchar("template_code", { length: 100 }).notNull(),
	templateName: varchar("template_name", { length: 200 }),
	recipientNo: varchar("recipient_no", { length: 20 }).notNull(),
	requestId: varchar("request_id", { length: 100 }),
	recipientSeq: integer("recipient_seq"),
	status: varchar({ length: 20 }).default('pending').notNull(),
	resultCode: varchar("result_code", { length: 20 }),
	resultMessage: text("result_message"),
	content: text(),
	triggerType: varchar("trigger_type", { length: 30 }),
	sentBy: uuid("sent_by"),
	sentAt: timestamp("sent_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	completedAt: timestamp("completed_at", { withTimezone: true, mode: 'string' }),
}, (table) => [
	foreignKey({
			columns: [table.sentBy],
			foreignColumns: [users.id],
			name: "alimtalk_send_logs_sent_by_users_id_fk"
		}),
	foreignKey({
			columns: [table.templateLinkId],
			foreignColumns: [alimtalkTemplateLinks.id],
			name: "alimtalk_send_logs_template_link_id_alimtalk_template_links_id_"
		}).onDelete("set null"),
]);

export const users = pgTable("users", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	orgId: uuid("org_id").notNull(),
	email: varchar({ length: 255 }).notNull(),
	password: varchar({ length: 255 }).notNull(),
	name: varchar({ length: 100 }).notNull(),
	role: varchar({ length: 20 }).default('member').notNull(),
	phone: varchar({ length: 20 }),
	isActive: integer("is_active").default(1).notNull(),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	foreignKey({
			columns: [table.orgId],
			foreignColumns: [organizations.id],
			name: "users_org_id_organizations_id_fk"
		}).onDelete("cascade"),
	unique("users_org_id_email_unique").on(table.orgId, table.email),
]);

export const workspaces = pgTable("workspaces", {
	id: serial().primaryKey().notNull(),
	orgId: uuid("org_id").notNull(),
	name: varchar({ length: 200 }).notNull(),
	description: text(),
	icon: varchar({ length: 50 }),
	settings: jsonb(),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	foreignKey({
			columns: [table.orgId],
			foreignColumns: [organizations.id],
			name: "workspaces_org_id_organizations_id_fk"
		}).onDelete("cascade"),
]);

export const workspacePermissions = pgTable("workspace_permissions", {
	id: serial().primaryKey().notNull(),
	workspaceId: integer("workspace_id").notNull(),
	userId: uuid("user_id").notNull(),
	permissionType: varchar("permission_type", { length: 20 }).notNull(),
	grantedBy: uuid("granted_by"),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	foreignKey({
			columns: [table.workspaceId],
			foreignColumns: [workspaces.id],
			name: "workspace_permissions_workspace_id_workspaces_id_fk"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.userId],
			foreignColumns: [users.id],
			name: "workspace_permissions_user_id_users_id_fk"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.grantedBy],
			foreignColumns: [users.id],
			name: "workspace_permissions_granted_by_users_id_fk"
		}),
	unique("workspace_permissions_workspace_id_user_id_unique").on(table.workspaceId, table.userId),
]);

export const alimtalkAutomationQueue = pgTable("alimtalk_automation_queue", {
	id: serial().primaryKey().notNull(),
	templateLinkId: integer("template_link_id").notNull(),
	recordId: integer("record_id").notNull(),
	orgId: uuid("org_id").notNull(),
	repeatCount: integer("repeat_count").default(0).notNull(),
	nextRunAt: timestamp("next_run_at", { withTimezone: true, mode: 'string' }).notNull(),
	status: varchar({ length: 20 }).default('pending').notNull(),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	index("aq_status_next_run_idx").using("btree", table.status.asc().nullsLast().op("text_ops"), table.nextRunAt.asc().nullsLast().op("text_ops")),
	index("aq_template_record_idx").using("btree", table.templateLinkId.asc().nullsLast().op("int4_ops"), table.recordId.asc().nullsLast().op("int4_ops")),
	foreignKey({
			columns: [table.templateLinkId],
			foreignColumns: [alimtalkTemplateLinks.id],
			name: "alimtalk_automation_queue_template_link_id_alimtalk_template_li"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.recordId],
			foreignColumns: [records.id],
			name: "alimtalk_automation_queue_record_id_records_id_fk"
		}).onDelete("cascade"),
]);

export const organizationInvitations = pgTable("organization_invitations", {
	id: serial().primaryKey().notNull(),
	orgId: uuid("org_id").notNull(),
	email: varchar({ length: 255 }).notNull(),
	role: varchar({ length: 20 }).default('member').notNull(),
	token: varchar({ length: 64 }).notNull(),
	status: varchar({ length: 20 }).default('pending').notNull(),
	invitedBy: uuid("invited_by").notNull(),
	expiresAt: timestamp("expires_at", { withTimezone: true, mode: 'string' }).notNull(),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	foreignKey({
			columns: [table.orgId],
			foreignColumns: [organizations.id],
			name: "organization_invitations_org_id_organizations_id_fk"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.invitedBy],
			foreignColumns: [users.id],
			name: "organization_invitations_invited_by_users_id_fk"
		}),
	unique("organization_invitations_token_unique").on(table.token),
]);
