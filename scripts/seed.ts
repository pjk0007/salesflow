import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { eq } from "drizzle-orm";
import * as dotenv from "dotenv";
import {
    organizations,
    users,
    workspaces,
    fieldDefinitions,
    partitions,
    statusOptionCategories,
    statusOptions,
} from "../src/lib/db/schema";
import {
    pgTable,
    uuid,
    text,
    varchar,
    boolean,
} from "drizzle-orm/pg-core";

dotenv.config({ path: ".env.local" });

// --- Sales DB ---
const salesUrl = process.env.DATABASE_URL;
if (!salesUrl) {
    throw new Error("DATABASE_URL 환경 변수가 설정되지 않았습니다.");
}
const salesClient = postgres(salesUrl);
const db = drizzle(salesClient);

// --- Adion DB (read-only) ---
const adionUrl = process.env.ADION_DATABASE_URL;
if (!adionUrl) {
    throw new Error("ADION_DATABASE_URL 환경 변수가 설정되지 않았습니다.");
}
const adionClient = postgres(adionUrl, { max: 3 });
const adionDb = drizzle(adionClient);

// Adion 테이블 정의
const adionUsers = pgTable("users", {
    id: uuid("id").primaryKey(),
    email: text("email").unique().notNull(),
    hashedPassword: text("hashed_password"),
    name: text("name"),
    role: varchar("role", { length: 20 }),
    phone: varchar("phone", { length: 20 }),
});

const adionOrganizations = pgTable("organizations", {
    id: uuid("id").primaryKey(),
    name: text("name").notNull(),
    slug: varchar("slug", { length: 100 }).notNull(),
    isActive: boolean("is_active"),
});

const adionOrgMembers = pgTable("organization_members", {
    id: uuid("id").primaryKey(),
    organizationId: uuid("organization_id").notNull(),
    userId: uuid("user_id").notNull(),
    role: varchar("role", { length: 20 }).notNull(),
});

function mapRole(adionRole: string): "owner" | "admin" | "member" {
    if (adionRole === "owner") return "owner";
    if (adionRole === "admin") return "admin";
    return "member";
}

async function seed() {
    console.log("Seeding Sales DB from Adion...\n");

    // 1. Adion에서 첫 번째 사용자 조회
    const [adionUser] = await adionDb.select().from(adionUsers).limit(1);
    if (!adionUser) {
        throw new Error("Adion에 사용자가 없습니다. 먼저 Adion에서 회원가입하세요.");
    }
    console.log(`Found Adion user: ${adionUser.email} (${adionUser.id})`);

    // 2. 해당 사용자의 조직 멤버십 조회
    const [membership] = await adionDb
        .select()
        .from(adionOrgMembers)
        .where(eq(adionOrgMembers.userId, adionUser.id))
        .limit(1);
    if (!membership) {
        throw new Error("Adion 사용자의 조직 멤버십이 없습니다.");
    }

    // 3. 조직 정보 조회
    const [adionOrg] = await adionDb
        .select()
        .from(adionOrganizations)
        .where(eq(adionOrganizations.id, membership.organizationId));
    if (!adionOrg) {
        throw new Error("Adion 조직을 찾을 수 없습니다.");
    }
    console.log(`Found Adion org: ${adionOrg.name} (${adionOrg.id})`);

    // 4. Sales DB에 조직 프로비저닝
    const [org] = await db
        .insert(organizations)
        .values({
            id: adionOrg.id,
            name: adionOrg.name,
            slug: adionOrg.slug,
            integratedCodePrefix: adionOrg.slug.toUpperCase().slice(0, 4),
            settings: { timezone: "Asia/Seoul", locale: "ko-KR" },
        })
        .onConflictDoNothing()
        .returning();

    const orgId = org?.id ?? adionOrg.id;
    console.log(`Provisioned organization: ${adionOrg.name} (id: ${orgId})`);

    // 5. Sales DB에 사용자 프로비저닝
    const salesRole = mapRole(membership.role);
    const [user] = await db
        .insert(users)
        .values({
            id: adionUser.id,
            orgId,
            email: adionUser.email,
            password: "adion-sso",
            name: adionUser.name || "사용자",
            role: salesRole,
        })
        .onConflictDoNothing()
        .returning();

    if (user) {
        console.log(`Provisioned user: ${user.email} (role: ${salesRole})`);
    } else {
        console.log(`User already exists: ${adionUser.email}`);
    }

    // 6. 워크스페이스 생성
    const [workspace] = await db
        .insert(workspaces)
        .values({
            orgId,
            name: "영업 관리",
            description: "고객 영업 관리 워크스페이스",
            icon: "briefcase",
        })
        .returning();
    console.log(`Created workspace: ${workspace.name} (id: ${workspace.id})`);

    // 7. 기본 필드 정의
    const defaultFields = [
        { key: "integratedCode", label: "통합코드", fieldType: "text", cellType: "readonly", isSystem: 1, sortOrder: 0, category: "시스템" },
        { key: "registeredAt", label: "등록일", fieldType: "datetime", cellType: "readonly", isSystem: 1, sortOrder: 1, category: "시스템" },
        { key: "progressStatus", label: "진행상태", fieldType: "select", cellType: "selectWithStatusBg", sortOrder: 2, category: "상태" },
        { key: "companyName", label: "상호명", fieldType: "text", cellType: "editable", sortOrder: 3, category: "고객정보", defaultWidth: 150 },
        { key: "representativeName", label: "대표자명", fieldType: "text", cellType: "editable", sortOrder: 4, category: "고객정보" },
        { key: "representativePhone", label: "대표 연락처", fieldType: "phone", cellType: "phone", sortOrder: 5, category: "고객정보" },
        { key: "businessNumber", label: "사업자번호", fieldType: "text", cellType: "editable", sortOrder: 6, category: "고객정보" },
        { key: "businessAddress", label: "사업장 주소", fieldType: "textarea", cellType: "textarea", sortOrder: 7, category: "고객정보", defaultWidth: 200 },
        { key: "email", label: "이메일", fieldType: "email", cellType: "email", sortOrder: 8, category: "고객정보" },
        { key: "salesperson", label: "담당 영업자", fieldType: "text", cellType: "editable", sortOrder: 9, category: "영업정보" },
        { key: "note", label: "비고", fieldType: "textarea", cellType: "textarea", sortOrder: 10, category: "기타", defaultWidth: 200 },
    ];

    for (const field of defaultFields) {
        await db.insert(fieldDefinitions).values({
            workspaceId: workspace.id,
            key: field.key,
            label: field.label,
            fieldType: field.fieldType,
            cellType: field.cellType || "editable",
            isSystem: field.isSystem || 0,
            isRequired: 0,
            sortOrder: field.sortOrder,
            category: field.category || null,
            defaultWidth: field.defaultWidth || 120,
            minWidth: 80,
        });
    }
    console.log(`Created ${defaultFields.length} field definitions`);

    // 8. 상태 옵션 카테고리 및 옵션
    const [statusCategory] = await db
        .insert(statusOptionCategories)
        .values({
            workspaceId: workspace.id,
            key: "progressStatus",
            label: "진행상태",
            sortOrder: 0,
        })
        .returning();

    const statusValues = [
        { value: "신규", label: "신규", bgColor: "bg-blue-100" },
        { value: "접수완료", label: "접수완료", bgColor: "bg-yellow-100" },
        { value: "상담중", label: "상담중", bgColor: "bg-orange-100" },
        { value: "계약완료", label: "계약완료", bgColor: "bg-green-100" },
        { value: "보류", label: "보류", bgColor: "bg-gray-100" },
        { value: "취소", label: "취소", bgColor: "bg-red-100" },
    ];

    for (let i = 0; i < statusValues.length; i++) {
        await db.insert(statusOptions).values({
            categoryId: statusCategory.id,
            value: statusValues[i].value,
            label: statusValues[i].label,
            bgColor: statusValues[i].bgColor,
            sortOrder: i,
        });
    }
    console.log(`Created ${statusValues.length} status options`);

    // 9. 파티션 생성
    const [partition] = await db
        .insert(partitions)
        .values({
            workspaceId: workspace.id,
            name: "전체 고객",
            displayOrder: 0,
            visibleFields: defaultFields.map((f) => f.key),
        })
        .returning();
    console.log(`Created partition: ${partition.name} (id: ${partition.id})`);

    console.log("\nSeed completed successfully!");
    console.log(`\nLogin with your Adion account at sales.adion.com`);
    console.log(`  Email: ${adionUser.email}`);

    process.exit(0);
}

seed().catch((error) => {
    console.error("Seed error:", error);
    process.exit(1);
});
