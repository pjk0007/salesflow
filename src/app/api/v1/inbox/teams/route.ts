import { NextRequest } from "next/server";
import { z } from "zod";
import { handleInbox, jsonBody } from "@/lib/inbox/http";
import { listTeams, saveTeam } from "@/lib/inbox-routing/repository";
import { createTeamInput } from "@/lib/inbox-routing/rules";
import {
    authenticatePlatform,
    authorizeChannel,
} from "@/lib/customer-platform/external-auth";
export async function GET(req: NextRequest) {
    return handleInbox(async () => {
        const ctx = await authenticatePlatform(req),
            channelId = z.coerce
                .number()
                .int()
                .positive()
                .parse(req.nextUrl.searchParams.get("channelId"));
        await authorizeChannel(ctx, channelId, "read");
        return listTeams(ctx.actor, channelId);
    });
}
export async function POST(req: NextRequest) {
    return handleInbox(async () => {
        const ctx = await authenticatePlatform(req),
            input = createTeamInput.parse(await jsonBody(req), {
                error: () => "팀 설정 입력값을 확인해주세요.",
            });
        await authorizeChannel(ctx, input.channelId, "create");
        return saveTeam(ctx.actor, null, input);
    });
}
