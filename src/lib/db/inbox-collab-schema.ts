import {
    pgTable,
    uuid,
    integer,
    serial,
    varchar,
    text,
    timestamp,
    primaryKey,
    uniqueIndex,
    index,
} from "drizzle-orm/pg-core";
import { users, workspaces, organizations } from "./schema";
import { inboxConversations } from "./inbox-schema";

/** 담당자는 아니지만 대화방을 팔로우한 직원 — 답장을 쓸 수 있고 새 메시지 알림을 받는다 */
export const inboxConversationFollowers = pgTable(
    "inbox_conversation_followers",
    {
        conversationId: uuid("conversation_id")
            .notNull()
            .references(() => inboxConversations.id, { onDelete: "cascade" }),
        userId: uuid("user_id")
            .notNull()
            .references(() => users.id, { onDelete: "cascade" }),
        createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    },
    (t) => [
        primaryKey({ columns: [t.conversationId, t.userId] }),
        index("inbox_conversation_followers_user").on(t.userId),
    ],
);

/** 사업부별 상담 매크로 — 답장 입력창에서 #이름으로 불러 쓰는 미리 써 둔 문구 */
export const inboxMacros = pgTable(
    "inbox_macros",
    {
        id: serial("id").primaryKey(),
        orgId: uuid("org_id")
            .notNull()
            .references(() => organizations.id, { onDelete: "cascade" }),
        workspaceId: integer("workspace_id")
            .notNull()
            .references(() => workspaces.id, { onDelete: "cascade" }),
        name: varchar("name", { length: 50 }).notNull(),
        body: text("body").notNull(),
        sortOrder: integer("sort_order").notNull().default(0),
        createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
        updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    },
    (t) => [uniqueIndex("inbox_macros_workspace_name").on(t.workspaceId, t.name)],
);

/** 사업부별 상담 담당자 — 상담 설정 › 상담 담당자에서 켠 직원. 담당자로 지정되고 답장하며, 담당 없는 문의 알림을 받는다 */
export const inboxResponders = pgTable(
    "inbox_responders",
    {
        orgId: uuid("org_id")
            .notNull()
            .references(() => organizations.id, { onDelete: "cascade" }),
        workspaceId: integer("workspace_id")
            .notNull()
            .references(() => workspaces.id, { onDelete: "cascade" }),
        userId: uuid("user_id")
            .notNull()
            .references(() => users.id, { onDelete: "cascade" }),
        createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    },
    (t) => [primaryKey({ columns: [t.workspaceId, t.userId] }), index("inbox_responders_org").on(t.orgId)],
);
