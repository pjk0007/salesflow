import type {
    crmPipelines,
    crmDeals,
    crmTasks,
    crmContacts,
    crmCompanies,
} from "@/lib/db/schema";
type JsonDates<T> = {
    [K in keyof T]: T[K] extends Date
        ? string
        : T[K] extends Date | null
          ? string | null
          : T[K];
};
export type Pipeline = JsonDates<typeof crmPipelines.$inferSelect>;
/** 목록 응답은 연결 고객·회사 이름을 함께 준다(상세·저장 응답에는 없다). */
type LinkedNames = {
    contactName?: string | null;
    companyName?: string | null;
    contactArchivedAt?: string | null;
    companyArchivedAt?: string | null;
};
export type Deal = JsonDates<typeof crmDeals.$inferSelect> & LinkedNames;
export type Task = JsonDates<typeof crmTasks.$inferSelect> & LinkedNames;
export type Contact = JsonDates<typeof crmContacts.$inferSelect> & {
    companyIds: string[];
};
export type Company = JsonDates<typeof crmCompanies.$inferSelect>;
export type Resource =
    | "pipelines"
    | "deals"
    | "tasks"
    | "contacts"
    | "companies";
export type Editor = {
    resource: Resource;
    item?: Pipeline | Deal | Task | Contact | Company;
    defaults?: Partial<Task & Deal>;
};
export interface DealHistory {
    id: string;
    actorName: string;
    createdAt: string;
    change: {
        action: string;
        stage?: { name: string; category: string };
        before?: Deal;
        after?: Deal;
    };
}
