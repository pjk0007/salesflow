import { NextRequest } from "next/server";
import { z } from "zod";
import { copyAdminApi } from "@/lib/ai-copy/api";
import { saveExperimentContact, saveExperimentContacts } from "@/lib/email-experiments/actions";
export const GET = (req: NextRequest) =>
    copyAdminApi(req, async (conn, user) => {
        const workspaceId = z.coerce
            .number()
            .int()
            .positive()
            .parse(req.nextUrl.searchParams.get("workspaceId"));
        const cursor = z.coerce
            .number()
            .int()
            .nonnegative()
            .parse(req.nextUrl.searchParams.get("cursor") ?? 0);
        const contacts =
            await conn`SELECT * FROM email_copy_experiment_contacts WHERE org_id=${user.orgId} AND workspace_id=${workspaceId} AND id>${cursor} ORDER BY id LIMIT 101`;
        return {
            contacts: contacts.slice(0, 100),
            nextCursor: contacts.length > 100 ? contacts[99].id : null,
        };
    });
export const POST = (req: NextRequest) =>
    copyAdminApi(req, (conn, user) =>
        req
            .json()
            .then((body) =>
                Array.isArray(body)
                    ? saveExperimentContacts(conn, body, {
                          orgId: user.orgId,
                          userId: user.userId,
                          now: new Date(),
                      })
                    : saveExperimentContact(conn, body, {
                          orgId: user.orgId,
                          userId: user.userId,
                          now: new Date(),
                      }),
            ),
    );
