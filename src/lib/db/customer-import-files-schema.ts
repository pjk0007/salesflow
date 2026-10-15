import {
    pgTable,
    uuid,
    integer,
    varchar,
    text,
    timestamp,
    boolean,
    jsonb,
    uniqueIndex,
    index,
} from "drizzle-orm/pg-core";
import { organizations, workspaces } from "./schema";
import { customerImports } from "./customer-import-schema";
import { inboxMessages } from "./inbox-schema";
import { inboxAttachments } from "./inbox-files-schema";
const time = (name: string) =>
    timestamp(name, { withTimezone: true, precision: 3 });
export const customerImportFiles = pgTable(
    "customer_import_files",
    {
        id: uuid("id").primaryKey().defaultRandom(),
        orgId: uuid("org_id")
            .notNull()
            .references(() => organizations.id, { onDelete: "cascade" }),
        workspaceId: integer("workspace_id")
            .notNull()
            .references(() => workspaces.id, { onDelete: "cascade" }),
        jobId: uuid("job_id")
            .notNull()
            .references(() => customerImports.id, { onDelete: "cascade" }),
        messageId: integer("message_id")
            .notNull()
            .references(() => inboxMessages.id, { onDelete: "cascade" }),
        sourceKey: varchar("source_key", { length: 64 }).notNull(),
        manifest: varchar("manifest", { length: 64 }).notNull(),
        fileName: varchar("file_name", { length: 180 }).notNull(),
        expectedSize: integer("expected_size"),
        expectedSha256: varchar("expected_sha256", { length: 64 }),
        locator: jsonb("locator")
            .$type<{
                originalId: string;
                key: string | null;
                index: number;
                conversationId: string;
                messageSourceId: string;
            }>()
            .notNull(),
        sourceUrl: text("source_url"),
        state: varchar("state", { length: 20 }).notNull().default("pending"),
        active: boolean("active").notNull().default(true),
        metadataValid: boolean("metadata_valid").notNull().default(true),
        version: integer("version").notNull().default(1),
        attempts: integer("attempts").notNull().default(0),
        leaseToken: uuid("lease_token"),
        leaseUntil: time("lease_until"),
        error: varchar("error", { length: 500 }),
        attachmentId: uuid("attachment_id").references(
            () => inboxAttachments.id,
            {
                onDelete: "set null",
            },
        ),
        createdAt: time("created_at").notNull().defaultNow(),
        updatedAt: time("updated_at").notNull().defaultNow(),
    },
    (t) => [
        uniqueIndex("customer_import_file_manifest").on(
            t.messageId,
            t.sourceKey,
            t.manifest,
        ),
        index("customer_import_file_job").on(t.jobId, t.id),
    ],
);
