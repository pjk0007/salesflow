import { relations } from "drizzle-orm/relations";
import { organizations, apiTokens, users, emailConfigs, emailTemplates, workspaces, fieldDefinitions, folders, alimtalkConfigs, partitions, alimtalkTemplateLinks, records, memos, partitionPermissions, statusOptionCategories, statusOptions, alimtalkSendLogs, workspacePermissions, alimtalkAutomationQueue, organizationInvitations } from "./schema";

export const apiTokensRelations = relations(apiTokens, ({one}) => ({
	organization: one(organizations, {
		fields: [apiTokens.orgId],
		references: [organizations.id]
	}),
	user: one(users, {
		fields: [apiTokens.createdBy],
		references: [users.id]
	}),
}));

export const organizationsRelations = relations(organizations, ({many}) => ({
	apiTokens: many(apiTokens),
	emailConfigs: many(emailConfigs),
	emailTemplates: many(emailTemplates),
	alimtalkConfigs: many(alimtalkConfigs),
	users: many(users),
	workspaces: many(workspaces),
	organizationInvitations: many(organizationInvitations),
}));

export const usersRelations = relations(users, ({one, many}) => ({
	apiTokens: many(apiTokens),
	alimtalkTemplateLinks: many(alimtalkTemplateLinks),
	memos: many(memos),
	partitionPermissions_userId: many(partitionPermissions, {
		relationName: "partitionPermissions_userId_users_id"
	}),
	partitionPermissions_grantedBy: many(partitionPermissions, {
		relationName: "partitionPermissions_grantedBy_users_id"
	}),
	alimtalkSendLogs: many(alimtalkSendLogs),
	organization: one(organizations, {
		fields: [users.orgId],
		references: [organizations.id]
	}),
	workspacePermissions_userId: many(workspacePermissions, {
		relationName: "workspacePermissions_userId_users_id"
	}),
	workspacePermissions_grantedBy: many(workspacePermissions, {
		relationName: "workspacePermissions_grantedBy_users_id"
	}),
	organizationInvitations: many(organizationInvitations),
}));

export const emailConfigsRelations = relations(emailConfigs, ({one}) => ({
	organization: one(organizations, {
		fields: [emailConfigs.orgId],
		references: [organizations.id]
	}),
}));

export const emailTemplatesRelations = relations(emailTemplates, ({one}) => ({
	organization: one(organizations, {
		fields: [emailTemplates.orgId],
		references: [organizations.id]
	}),
}));

export const fieldDefinitionsRelations = relations(fieldDefinitions, ({one}) => ({
	workspace: one(workspaces, {
		fields: [fieldDefinitions.workspaceId],
		references: [workspaces.id]
	}),
}));

export const workspacesRelations = relations(workspaces, ({one, many}) => ({
	fieldDefinitions: many(fieldDefinitions),
	folders: many(folders),
	statusOptionCategories: many(statusOptionCategories),
	partitions: many(partitions),
	organization: one(organizations, {
		fields: [workspaces.orgId],
		references: [organizations.id]
	}),
	workspacePermissions: many(workspacePermissions),
}));

export const foldersRelations = relations(folders, ({one}) => ({
	workspace: one(workspaces, {
		fields: [folders.workspaceId],
		references: [workspaces.id]
	}),
}));

export const alimtalkConfigsRelations = relations(alimtalkConfigs, ({one}) => ({
	organization: one(organizations, {
		fields: [alimtalkConfigs.orgId],
		references: [organizations.id]
	}),
}));

export const alimtalkTemplateLinksRelations = relations(alimtalkTemplateLinks, ({one, many}) => ({
	partition: one(partitions, {
		fields: [alimtalkTemplateLinks.partitionId],
		references: [partitions.id]
	}),
	user: one(users, {
		fields: [alimtalkTemplateLinks.createdBy],
		references: [users.id]
	}),
	alimtalkSendLogs: many(alimtalkSendLogs),
	alimtalkAutomationQueues: many(alimtalkAutomationQueue),
}));

export const partitionsRelations = relations(partitions, ({one, many}) => ({
	alimtalkTemplateLinks: many(alimtalkTemplateLinks),
	partitionPermissions: many(partitionPermissions),
	workspace: one(workspaces, {
		fields: [partitions.workspaceId],
		references: [workspaces.id]
	}),
	records: many(records),
}));

export const memosRelations = relations(memos, ({one}) => ({
	record: one(records, {
		fields: [memos.recordId],
		references: [records.id]
	}),
	user: one(users, {
		fields: [memos.createdBy],
		references: [users.id]
	}),
}));

export const recordsRelations = relations(records, ({one, many}) => ({
	memos: many(memos),
	partition: one(partitions, {
		fields: [records.partitionId],
		references: [partitions.id]
	}),
	alimtalkAutomationQueues: many(alimtalkAutomationQueue),
}));

export const partitionPermissionsRelations = relations(partitionPermissions, ({one}) => ({
	partition: one(partitions, {
		fields: [partitionPermissions.partitionId],
		references: [partitions.id]
	}),
	user_userId: one(users, {
		fields: [partitionPermissions.userId],
		references: [users.id],
		relationName: "partitionPermissions_userId_users_id"
	}),
	user_grantedBy: one(users, {
		fields: [partitionPermissions.grantedBy],
		references: [users.id],
		relationName: "partitionPermissions_grantedBy_users_id"
	}),
}));

export const statusOptionCategoriesRelations = relations(statusOptionCategories, ({one, many}) => ({
	workspace: one(workspaces, {
		fields: [statusOptionCategories.workspaceId],
		references: [workspaces.id]
	}),
	statusOptions: many(statusOptions),
}));

export const statusOptionsRelations = relations(statusOptions, ({one}) => ({
	statusOptionCategory: one(statusOptionCategories, {
		fields: [statusOptions.categoryId],
		references: [statusOptionCategories.id]
	}),
}));

export const alimtalkSendLogsRelations = relations(alimtalkSendLogs, ({one}) => ({
	user: one(users, {
		fields: [alimtalkSendLogs.sentBy],
		references: [users.id]
	}),
	alimtalkTemplateLink: one(alimtalkTemplateLinks, {
		fields: [alimtalkSendLogs.templateLinkId],
		references: [alimtalkTemplateLinks.id]
	}),
}));

export const workspacePermissionsRelations = relations(workspacePermissions, ({one}) => ({
	workspace: one(workspaces, {
		fields: [workspacePermissions.workspaceId],
		references: [workspaces.id]
	}),
	user_userId: one(users, {
		fields: [workspacePermissions.userId],
		references: [users.id],
		relationName: "workspacePermissions_userId_users_id"
	}),
	user_grantedBy: one(users, {
		fields: [workspacePermissions.grantedBy],
		references: [users.id],
		relationName: "workspacePermissions_grantedBy_users_id"
	}),
}));

export const alimtalkAutomationQueueRelations = relations(alimtalkAutomationQueue, ({one}) => ({
	alimtalkTemplateLink: one(alimtalkTemplateLinks, {
		fields: [alimtalkAutomationQueue.templateLinkId],
		references: [alimtalkTemplateLinks.id]
	}),
	record: one(records, {
		fields: [alimtalkAutomationQueue.recordId],
		references: [records.id]
	}),
}));

export const organizationInvitationsRelations = relations(organizationInvitations, ({one}) => ({
	organization: one(organizations, {
		fields: [organizationInvitations.orgId],
		references: [organizations.id]
	}),
	user: one(users, {
		fields: [organizationInvitations.invitedBy],
		references: [users.id]
	}),
}));