import { z } from "zod";
import { InboxError } from "@/lib/inbox/errors";

const providerInput = z.object({
    channelKey: z.string().regex(/^[a-f0-9]{48}$/),
    projectId: z.string().regex(/^[a-z][a-z0-9-]{4,28}[a-z0-9]$/),
    apiKey: z.string().regex(/^AIza[A-Za-z0-9_-]{30,50}$/),
}).strict();
export type FirebaseSiteProvider = z.infer<typeof providerInput>;
export function firebaseSiteProvider(key: string, raw = process.env.INBOX_FIREBASE_SITE_PROVIDERS) {
    try {
        const providers = z.array(providerInput).max(20).parse(JSON.parse(raw || "[]"));
        const matches = providers.filter(p => p.channelKey === key);
        if (matches.length !== 1) throw new Error("configuration");
        return matches[0];
    } catch {
        throw new InboxError("회원 상담 연결 설정이 필요합니다.", 503);
    }
}
const uidInput = z.string().min(1).max(128).regex(/^[A-Za-z0-9_-]+$/);
const claimsInput = z.object({
    sub: uidInput, aud: z.string(), iss: z.string(),
    exp: z.number().int(), iat: z.number().int(), auth_time: z.number().int(),
    firebase: z.object({ tenant: z.string().optional() }).passthrough().optional(),
});
const loginError = () => new InboxError("사이트 로그인을 다시 확인해주세요.", 401);
const upstreamError = () => new InboxError("회원 정보를 확인하지 못했습니다. 잠시 후 다시 연결해주세요.", 502);
type Dependencies = { fetch?: typeof fetch; now?: Date };
/** Google verifies the exact token. Firestore reads use that same user's token and Security Rules, never admin credentials. */
export async function verifyFirebaseSiteMember(provider: FirebaseSiteProvider, token: string, deps: Dependencies = {}) {
    if (!token || token.length > 8192 || !/^[\w-]+\.[\w-]+\.[\w-]+$/.test(token)) throw loginError();
    let claims: z.infer<typeof claimsInput>;
    try {
        claims = claimsInput.parse(JSON.parse(Buffer.from(token.split(".")[1], "base64url").toString("utf8")));
    } catch { throw loginError(); }
    const now = Math.floor((deps.now ?? new Date()).getTime() / 1000);
    if (claims.aud !== provider.projectId || claims.iss !== `https://securetoken.google.com/${provider.projectId}` ||
        claims.exp <= now || claims.iat > now + 30 || claims.auth_time > now + 30 ||
        claims.auth_time < 0 || claims.iat < claims.auth_time || claims.firebase?.tenant) throw loginError();
    const transport = deps.fetch ?? fetch;
    const signal = AbortSignal.timeout(8000);
    let account: { localId: string; email?: string; disabled?: boolean; validSince?: string };
    try {
        const response = await transport(`https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${encodeURIComponent(provider.apiKey)}`, {
            method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ idToken: token }), redirect: "error", cache: "no-store", signal,
        });
        if (response.status === 400 || response.status === 401) throw loginError();
        if (!response.ok) throw upstreamError();
        const data = z.object({ users: z.array(z.object({
            localId: uidInput, email: z.string().optional(), disabled: z.boolean().optional(),
            validSince: z.string().regex(/^\d+$/).optional(),
        })).length(1) }).parse(await response.json());
        account = data.users[0];
        if (account.localId !== claims.sub || account.disabled ||
            claims.auth_time < Number(account.validSince ?? "0")) throw loginError();
    } catch (error) {
        if (error instanceof InboxError) throw error;
        throw upstreamError();
    }
    // A fixed, UID-bound document and field mask exclude unrelated customer and private fields.
    const fields = ["name", "userType", "phone", "companyName", "isInternal"];
    const path = `projects/${provider.projectId}/databases/(default)/documents/users/${claims.sub}`;
    let values: Record<string, { stringValue?: string; booleanValue?: boolean }>;
    try {
        const response = await transport(`https://firestore.googleapis.com/v1/${path}?${fields.map(f => `mask.fieldPaths=${f}`).join("&")}`, {
            headers: { Authorization: `Bearer ${token}` }, redirect: "error", cache: "no-store", signal,
        });
        if ([401, 403, 404].includes(response.status)) throw loginError();
        if (!response.ok) throw upstreamError();
        const doc = z.object({ name: z.literal(path), fields: z.record(z.string(), z.object({
            stringValue: z.string().optional(), booleanValue: z.boolean().optional(),
        }).passthrough()) }).parse(await response.json());
        values = doc.fields;
    } catch (error) {
        if (error instanceof InboxError) throw error;
        throw upstreamError();
    }
    const role = values.userType?.stringValue;
    if (role !== "client" && role !== "partner") throw new InboxError("고객 또는 디자이너 회원으로 로그인해주세요.", 403);
    const short = (v: string | undefined, max: number) => v?.trim().slice(0, max) || undefined;
    const email = z.email().safeParse(account.email);
    return {
        externalId: claims.sub,
        name: short(values.name?.stringValue, 100) ?? (role === "partner" ? "디자이너 회원" : "고객 회원"),
        ...(email.success ? { email: email.data.toLowerCase() } : {}),
        ...(short(values.phone?.stringValue, 40) ? { phone: short(values.phone?.stringValue, 40) } : {}),
        ...(values.isInternal?.booleanValue === true ? { isInternal: true } : {}),
        attributes: { firebaseProject: provider.projectId, siteMemberType: role,
            ...(short(values.companyName?.stringValue, 200) ? { companyName: short(values.companyName?.stringValue, 200) } : {}),
        },
    };
}
