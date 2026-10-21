import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { hashPassword } from "../../../src/lib/auth";
import { db, queryClient, organizations, organizationMembers, users, workspaces, partitions, fieldDefinitions, emailTemplates, emailSenderProfiles } from "../../../src/lib/db";

async function main() {
    assert.equal(process.env.DATABASE_URL, "postgresql://jaehun@localhost:5432/salesflow");
    try {
        if (process.argv[2] === "cleanup") {
            const slug = process.argv[3];
            assert.ok(slug?.startsWith("sender-ui-"));
            await db.delete(organizations).where(eq(organizations.slug, slug));
            console.info("UI fixture cleanup complete");
            return;
        }
        const slug = `sender-ui-${randomUUID()}`;
        const [org] = await db.insert(organizations).values({ name: "Sender UI fixture", slug, onboardingCompleted: true }).returning();
        const [user] = await db.insert(users).values({ orgId: org.id, name: "Sender UI", email: `${slug}@example.invalid`, password: await hashPassword(process.env.FIXTURE_PASSWORD ?? ""), role: "owner" }).returning();
        await db.insert(organizationMembers).values({ organizationId: org.id, userId: user.id, role: "owner" });
        const [workspace] = await db.insert(workspaces).values({ orgId: org.id, name: "Sender UI workspace" }).returning();
        const [partition] = await db.insert(partitions).values({ workspaceId: workspace.id, name: "Sender UI partition" }).returning();
        await db.insert(fieldDefinitions).values({ workspaceId: workspace.id, key: "email", label: "이메일", fieldType: "email" });
        const [template] = await db.insert(emailTemplates).values({ orgId: org.id, name: "Sender UI template", subject: "fixture", htmlBody: "fixture" }).returning();
        const profiles = await db.insert(emailSenderProfiles).values([
            { orgId: org.id, name: "Sender UI A", fromName: "A", fromEmail: "a@example.invalid", isDefault: true },
            { orgId: org.id, name: "Sender UI B", fromName: "B", fromEmail: "b@example.invalid" },
        ]).returning();
        console.info(JSON.stringify({ slug, email: user.email, partitionId: partition.id, templateId: template.id, profileIds: profiles.map(p => p.id) }));
    } finally {
        await queryClient.end();
    }
}
void main().catch(error => { console.error(error); process.exitCode = 1; });
