import { isProductionServer } from "./deep-visitor-alert-rules";
import { chatWebhookProblem } from "./google-chat";

type Env = Record<string, string | undefined>;

/** 사업별 주소를 지정하면 공통 주소로 대체하지 않는다. 설정 키만으로 발송 대상이 늘어나지 않는다. */
export function journeyAlertConfig(env: Env) {
    const ids = [...new Set((env.JOURNEY_ALERT_WORKSPACE_IDS ?? "").split(",").map((v) => Number(v.trim())).filter((v) => Number.isSafeInteger(v) && v > 0))];
    const requested = (env.JOURNEY_ALERT_MODE ?? "off").trim();
    const mode = requested === "live" && (isProductionServer(env) || env.JOURNEY_ALERT_TEST_SERVER_LIVE === "1") ? "live" : requested === "off" ? "off" : "dry_run";
    const routes: Record<number, string> = {};
    let configurationError: "invalid_workspace_webhooks" | undefined;
    if (env.JOURNEY_ALERT_WEBHOOKS_BY_WORKSPACE !== undefined) {
        try {
            const parsed: unknown = JSON.parse(env.JOURNEY_ALERT_WEBHOOKS_BY_WORKSPACE);
            if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error();
            for (const [key, value] of Object.entries(parsed)) {
                if (!/^[1-9]\d*$/.test(key) || !Number.isSafeInteger(Number(key)) || typeof value !== "string" || chatWebhookProblem(value)) throw new Error();
                routes[Number(key)] = value.trim();
            }
        } catch {
            configurationError = "invalid_workspace_webhooks";
        }
    } else {
        const webhook = (env.JOURNEY_ALERT_WEBHOOK_URL ?? "").trim();
        if (!chatWebhookProblem(webhook)) for (const id of ids) routes[id] = webhook;
    }
    const readyIds = configurationError ? [] : ids.filter((id) => Boolean(routes[id]));
    return { ids, mode, routes, readyIds, missingIds: ids.filter((id) => !readyIds.includes(id)), configurationError,
        baseUrl: env.NEXT_PUBLIC_BASE_URL || "https://sendb.kr" };
}
