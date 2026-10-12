import { NextRequest, NextResponse } from "next/server";
import { db, workspaces } from "@/lib/db";
import { eq, and } from "drizzle-orm";
import { getUserFromNextRequest } from "@/lib/auth";
import { requireAdmin } from "@/lib/auth-admin";
import { normalizeReplyToInput } from "@/lib/reply-to-rules";
import { lookupEmailMx } from "@/lib/email-mx-lookup";

/**
 * 응답에 싣는 칸. replyToEmail = 답장 받을 주소 (DESIGN-3). 칸과 API는 남아 있지만 발송에 쓰지 않는다 —
 * NHN이 Reply-To 사용자 지정 헤더를 거절해(2026-10-04 실제 발송) 설정 화면에서도 칸을 뺐다. 답장은 보낸 주소로 간다
 */
const workspaceSettingsColumns = {
    id: workspaces.id,
    name: workspaces.name,
    description: workspaces.description,
    icon: workspaces.icon,
    codePrefix: workspaces.codePrefix,
    defaultFieldTypeId: workspaces.defaultFieldTypeId,
    settings: workspaces.settings,
    replyToEmail: workspaces.replyToEmail,
};

/** MX가 없는 답장 주소를 저장했을 때 함께 돌려주는 안내 (저장은 막지 않는다 — DNS 일시 오류일 수 있다) */
function replyToMxWarning(email: string | null, mx: string | null): string | undefined {
    if (!email || mx !== "none") return undefined;
    const domain = email.slice(email.lastIndexOf("@") + 1);
    return `${domain} 도메인은 메일을 받는 서버(MX)가 없어 이 주소로는 답장이 도착하지 않습니다. 저장은 되었습니다.`;
}

export async function GET(
    req: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    const user = getUserFromNextRequest(req);
    if (!user) {
        return NextResponse.json({ success: false, error: "인증이 필요합니다." }, { status: 401 });
    }

    if (user.role === "member") {
        return NextResponse.json({ success: false, error: "접근 권한이 없습니다." }, { status: 403 });
    }

    const { id } = await params;
    const workspaceId = Number(id);
    if (!workspaceId || isNaN(workspaceId)) {
        return NextResponse.json({ success: false, error: "잘못된 워크스페이스 ID입니다." }, { status: 400 });
    }

    try {
        const [ws] = await db
            .select(workspaceSettingsColumns)
            .from(workspaces)
            .where(and(eq(workspaces.id, workspaceId), eq(workspaces.orgId, user.orgId)));

        if (!ws) {
            return NextResponse.json({ success: false, error: "워크스페이스를 찾을 수 없습니다." }, { status: 404 });
        }

        // 답장 받을 주소 도메인의 MX (도메인마다 캐시 — ok 하루, none·unknown 10분, 짧은 시간 제한). 주소가 없으면 null
        const replyToMx = await lookupEmailMx(ws.replyToEmail);
        return NextResponse.json({ success: true, data: { ...ws, replyToMx } });
    } catch (error) {
        console.error("Workspace settings fetch error:", error);
        return NextResponse.json({ success: false, error: "서버 오류가 발생했습니다." }, { status: 500 });
    }
}

export async function PATCH(
    req: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    // 답장 받을 주소는 그 사업으로 오는 고객 답장을 모두 다른 메일함으로 돌릴 수 있는 칸이다 (DESIGN-3 2절 "관리자만").
    // JWT에 적힌 역할만 보면 강등되거나 조직에서 빠진 관리자의 옛 토큰(30일)도 통과하므로, 저장은 DB의 현재 역할과
    // token_version을 보는 requireAdmin을 거친다 — 멤버 403, 옛 토큰·조직에서 빠짐 401. 조직 범위도 그 결과의 orgId로 본다
    const auth = await requireAdmin(req);
    if (!auth.ok) {
        return NextResponse.json({ success: false, error: auth.error }, { status: auth.status });
    }
    const user = auth.user;

    const { id } = await params;
    const workspaceId = Number(id);
    if (!workspaceId || isNaN(workspaceId)) {
        return NextResponse.json({ success: false, error: "잘못된 워크스페이스 ID입니다." }, { status: 400 });
    }

    try {
        const { name, description, icon, codePrefix, defaultFieldTypeId, replyToEmail } = await req.json();

        if (name !== undefined && !name.trim()) {
            return NextResponse.json({ success: false, error: "이름을 입력해주세요." }, { status: 400 });
        }

        // 답장 받을 주소 (DESIGN-3 2절, R4). 보내지 않으면 그대로, null·빈 문자열이면 지운다 (Reply-To 헤더 없음).
        // 형식이 틀리면 400. MX가 없어도 저장한다 — 응답의 replyToMx·warning으로 알린다
        let nextReplyTo: string | null | undefined;
        if (replyToEmail !== undefined) {
            const normalized = normalizeReplyToInput(replyToEmail);
            if (!normalized.ok) {
                return NextResponse.json({ success: false, error: normalized.error }, { status: 400 });
            }
            nextReplyTo = normalized.value;
        }

        // 같은 조직의 워크스페이스인지 확인
        const [existing] = await db
            .select()
            .from(workspaces)
            .where(and(eq(workspaces.id, workspaceId), eq(workspaces.orgId, user.orgId)));

        if (!existing) {
            return NextResponse.json({ success: false, error: "워크스페이스를 찾을 수 없습니다." }, { status: 404 });
        }

        const updateData: Record<string, unknown> = {
            updatedAt: new Date(),
        };

        if (name !== undefined) {
            updateData.name = name.trim();
        }
        if (description !== undefined) {
            updateData.description = description;
        }
        if (icon !== undefined) {
            updateData.icon = icon;
        }
        if (codePrefix !== undefined) {
            updateData.codePrefix = codePrefix;
        }
        if (defaultFieldTypeId !== undefined) {
            updateData.defaultFieldTypeId = defaultFieldTypeId;
        }
        if (nextReplyTo !== undefined) {
            updateData.replyToEmail = nextReplyTo;
        }

        // MX 조회는 저장과 함께 시작한다 — 저장을 기다리게 하거나 막지 않는다 (조회 실패는 "unknown")
        const mxPromise = nextReplyTo !== undefined ? lookupEmailMx(nextReplyTo) : null;

        const [updated] = await db
            .update(workspaces)
            .set(updateData)
            .where(eq(workspaces.id, workspaceId))
            .returning(workspaceSettingsColumns);

        const replyToMx = await (mxPromise ?? lookupEmailMx(updated.replyToEmail));
        const warning = nextReplyTo !== undefined ? replyToMxWarning(updated.replyToEmail, replyToMx) : undefined;
        return NextResponse.json({
            success: true,
            data: { ...updated, replyToMx },
            // 답장 받을 주소를 보냈을 때만: 그 도메인의 MX 조회 결과 ("ok" | "none" | "unknown", 주소를 지웠으면 null)
            ...(nextReplyTo !== undefined ? { mx: replyToMx } : {}),
            ...(warning ? { warning } : {}),
        });
    } catch (error) {
        console.error("Workspace settings update error:", error);
        return NextResponse.json({ success: false, error: "서버 오류가 발생했습니다." }, { status: 500 });
    }
}
