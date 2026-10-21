import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { NextRequest } from "next/server";
import { eq, inArray } from "drizzle-orm";
import { db, queryClient, organizations, users, workspaces, partitions, emailTemplates, emailSenderProfiles, emailTemplateLinks } from "../../../src/lib/db";
import { generateToken } from "../../../src/lib/auth";
import { POST, GET } from "../../../src/app/api/email/template-links/route";
import { PUT } from "../../../src/app/api/email/template-links/[id]/route";

async function main() {
    assert.equal(process.env.DATABASE_URL, "postgresql://jaehun@localhost:5432/salesflow");
    const orgId = randomUUID();
    const otherOrgId = randomUUID();
    try {
        await db.insert(organizations).values([
            { id: orgId, name: "sender API fixture", slug: orgId },
            { id: otherOrgId, name: "other fixture", slug: otherOrgId },
        ]);
        const [user] = await db.insert(users).values({ orgId, name: "fixture", email: "fixture@example.invalid", password: "unused" }).returning();
        const [workspace] = await db.insert(workspaces).values({ orgId, name: "fixture" }).returning();
        const [partition] = await db.insert(partitions).values({ workspaceId: workspace.id, name: "fixture" }).returning();
        const [template] = await db.insert(emailTemplates).values({ orgId, name: "fixture", subject: "fixture", htmlBody: "fixture" }).returning();
        const profiles = await db.insert(emailSenderProfiles).values([
            { orgId, name: "A", fromName: "A", fromEmail: "a@example.invalid" },
            { orgId, name: "B", fromName: "B", fromEmail: "b@example.invalid" },
            { orgId: otherOrgId, name: "foreign", fromName: "foreign", fromEmail: "foreign@example.invalid" },
        ]).returning();
        const [a, b, foreign] = profiles.map(p => p.id);
        const token = generateToken({ userId: user.id, orgId, email: user.email, name: user.name, role: "owner" });
        const request = (method: string, body?: object) => new NextRequest("http://localhost/api/email/template-links", {
            method, headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
            ...(body ? { body: JSON.stringify(body) } : {}),
        });
        const base = { partitionId: partition.id, emailTemplateId: template.id, name: "fixture", recipientField: "email" };
        const create = async (body: object) => {
            const response = await POST(request("POST", { ...base, ...body }));
            return { status: response.status, result: await response.json() };
        };
        const created = await create({ senderProfileIds: [b, a, b] });
        assert.equal(created.status, 201);
        assert.deepEqual(created.result.data.senderProfileIds, [b, a]);
        assert.equal(created.result.data.senderProfileId, b);
        const id: number = created.result.data.id;
        const update = async (body: object) => {
            const response = await PUT(request("PUT", body), { params: Promise.resolve({ id: String(id) }) });
            return { status: response.status, result: await response.json() };
        };
        console.info("B3 PASS: POST 201, ordered deduplication and first id");
        for (const badId of [foreign, 999999]) {
            const before = await db.select().from(emailTemplateLinks).where(eq(emailTemplateLinks.partitionId, partition.id));
            const invalid = await create({ senderProfileIds: [a, badId] });
            assert.equal(invalid.status, 400);
            assert.equal(invalid.result.error, "선택한 발신 주소를 찾을 수 없습니다.");
            const changed = await update({ name: "must not persist", senderProfileIds: [badId] });
            assert.equal(changed.status, 400);
            assert.equal(changed.result.error, invalid.result.error);
            const after = await db.select().from(emailTemplateLinks).where(eq(emailTemplateLinks.partitionId, partition.id));
            assert.deepEqual(after, before);
        }
        console.info("B4 PASS: foreign/missing id rejected, POST/PUT rows unchanged");
        const toggle = await update({ isActive: 0 });
        assert.equal(toggle.status, 200);
        assert.deepEqual(toggle.result.data.senderProfileIds, [b, a]);
        assert.equal(toggle.result.data.senderProfileId, b);
        console.info("B6 PASS: omitted sender fields preserved");
        for (const value of [[], null]) {
            for (const response of [await create({ senderProfileIds: value }), await update({ senderProfileIds: value })]) {
                assert.equal(response.result.data.senderProfileId, null);
                assert.equal(response.result.data.senderProfileIds, null);
            }
        }
        console.info("B5 PASS: empty/null POST and PUT clear both fields");
        for (const value of ["3", [0], [1.5], Array.from({ length: 51 }, (_, i) => i + 1)]) {
            assert.equal((await create({ senderProfileIds: value })).status, 400);
            assert.equal((await update({ senderProfileIds: value })).status, 400);
        }
        console.info("B7 PASS: malformed/over-50 pools return 400 for POST and PUT");
        for (const response of [await create({ senderProfileId: a }), await update({ senderProfileId: a })]) {
            assert.equal(response.result.data.senderProfileId, a);
            assert.deepEqual(response.result.data.senderProfileIds, [a]);
        }
        console.info("B8 PASS: legacy single id becomes pool");
        const response = await GET(request("GET"));
        assert.equal(response.status, 200);
        const body = await response.json();
        assert.ok(body.data.length > 0);
        for (const row of body.data) {
            assert.ok("senderProfileId" in row);
            assert.ok("senderProfileIds" in row);
        }
        console.info("B9 PASS: GET exposes both fields");
        console.info("API scenarios: 7 passed, 0 failed; no email transport invoked");
    } finally {
        await db.delete(organizations).where(inArray(organizations.id, [orgId, otherOrgId]));
        await queryClient.end();
    }
}
void main().catch(error => { console.error(error); process.exitCode = 1; });
