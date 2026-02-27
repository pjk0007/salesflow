import type { NextApiRequest, NextApiResponse } from "next";
import { db, workspaces, folders, partitions, fieldDefinitions } from "@/lib/db";
import { eq, and, asc } from "drizzle-orm";
import { getUserFromRequest } from "@/lib/auth";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
    if (req.method === "GET") return handleGet(req, res);
    if (req.method === "POST") return handlePost(req, res);
    return res.status(405).json({ success: false, error: "Method not allowed" });
}

async function handleGet(req: NextApiRequest, res: NextApiResponse) {
    const user = getUserFromRequest(req);
    if (!user) {
        return res.status(401).json({ success: false, error: "인증이 필요합니다." });
    }

    const workspaceId = Number(req.query.id);
    if (!workspaceId) {
        return res.status(400).json({ success: false, error: "워크스페이스 ID가 필요합니다." });
    }

    try {
        // 워크스페이스 소유권 검증
        const [workspace] = await db
            .select({ id: workspaces.id })
            .from(workspaces)
            .where(and(eq(workspaces.id, workspaceId), eq(workspaces.orgId, user.orgId)));

        if (!workspace) {
            return res.status(404).json({ success: false, error: "워크스페이스를 찾을 수 없습니다." });
        }

        // 폴더 목록
        const folderList = await db
            .select()
            .from(folders)
            .where(eq(folders.workspaceId, workspaceId))
            .orderBy(asc(folders.displayOrder), asc(folders.id));

        // 파티션 목록
        const partitionList = await db
            .select()
            .from(partitions)
            .where(eq(partitions.workspaceId, workspaceId))
            .orderBy(asc(partitions.displayOrder), asc(partitions.id));

        // 폴더별 파티션 그룹핑
        const folderMap = folderList.map((folder) => ({
            ...folder,
            partitions: partitionList.filter((p) => p.folderId === folder.id),
        }));

        // 미분류 파티션 (folderId가 null)
        const ungrouped = partitionList.filter((p) => p.folderId === null);

        return res.status(200).json({
            success: true,
            data: {
                folders: folderMap,
                ungrouped,
            },
        });
    } catch (error) {
        console.error("Partitions fetch error:", error);
        return res.status(500).json({ success: false, error: "서버 오류가 발생했습니다." });
    }
}

async function handlePost(req: NextApiRequest, res: NextApiResponse) {
    const user = getUserFromRequest(req);
    if (!user) {
        return res.status(401).json({ success: false, error: "인증이 필요합니다." });
    }
    if (user.role === "member") {
        return res.status(403).json({ success: false, error: "접근 권한이 없습니다." });
    }

    const workspaceId = Number(req.query.id);
    if (!workspaceId) {
        return res.status(400).json({ success: false, error: "워크스페이스 ID가 필요합니다." });
    }

    const { name, folderId } = req.body;
    if (!name || !name.trim()) {
        return res.status(400).json({ success: false, error: "이름을 입력해주세요." });
    }

    try {
        // 워크스페이스 소유권 검증
        const [workspace] = await db
            .select({ id: workspaces.id })
            .from(workspaces)
            .where(and(eq(workspaces.id, workspaceId), eq(workspaces.orgId, user.orgId)));

        if (!workspace) {
            return res.status(404).json({ success: false, error: "워크스페이스를 찾을 수 없습니다." });
        }

        // folderId 검증
        if (folderId) {
            const [folder] = await db
                .select({ id: folders.id })
                .from(folders)
                .where(and(eq(folders.id, folderId), eq(folders.workspaceId, workspaceId)));
            if (!folder) {
                return res.status(400).json({ success: false, error: "폴더를 찾을 수 없습니다." });
            }
        }

        // 기본 visibleFields: 워크스페이스의 전체 필드 key 목록
        const fieldList = await db
            .select({ key: fieldDefinitions.key })
            .from(fieldDefinitions)
            .where(eq(fieldDefinitions.workspaceId, workspaceId))
            .orderBy(asc(fieldDefinitions.sortOrder));

        const visibleFields = fieldList.map((f) => f.key);

        const [created] = await db
            .insert(partitions)
            .values({
                workspaceId,
                name: name.trim(),
                folderId: folderId || null,
                visibleFields,
            })
            .returning({
                id: partitions.id,
                name: partitions.name,
                folderId: partitions.folderId,
            });

        return res.status(201).json({ success: true, data: created });
    } catch (error) {
        console.error("Partition create error:", error);
        return res.status(500).json({ success: false, error: "서버 오류가 발생했습니다." });
    }
}
