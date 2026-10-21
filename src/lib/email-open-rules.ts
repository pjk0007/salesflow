/** 발송 후 60초 미만(음수 포함)은 기계 오픈이다. 단위 ms. */
export const MACHINE_OPEN_WINDOW_MS = 60_000;
export const MACHINE_OPEN_UA_PATTERN =
    "curl|python|node-fetch|axios|ruby|go-http|java/|okhttp|httpclient|libwww|wget|guard|antispam|linker|scan|bot|spider|crawl|preview|headless|phantomjs|^mozilla/5[.]0 chrome/";
export const HUMAN_IMAGE_PROXY_PATTERN = "googleimageproxy|yahoomailproxy";
export type MachineOpenReason = "ua" | "early";
const machinePattern = new RegExp(MACHINE_OPEN_UA_PATTERN, "i");
const proxyPattern = new RegExp(HUMAN_IMAGE_PROXY_PATTERN, "i");

/** 빈 UA는 기계이며, 이미지 프록시 예외가 기계 토큰보다 우선한다. */
export function isMachineOpenUserAgent(userAgent: string | null | undefined): boolean {
    if (!userAgent?.trim()) return true;
    if (proxyPattern.test(userAgent)) return false;
    return machinePattern.test(userAgent);
}

export function isEarlyOpen(sentAt: Date, openedAt: Date): boolean {
    return openedAt.getTime() - sentAt.getTime() < MACHINE_OPEN_WINDOW_MS;
}

/** UA와 시간 규칙이 겹치면 ua를 반환한다. */
export function machineOpenReason(input: {
    userAgent: string | null | undefined;
    sentAt: Date;
    openedAt: Date;
}): MachineOpenReason | null {
    if (isMachineOpenUserAgent(input.userAgent)) return "ua";
    return isEarlyOpen(input.sentAt, input.openedAt) ? "early" : null;
}

export const HUMAN_OPENS_PER_SEND_MAX = 20;
export const MACHINE_OPENS_PER_SEND_MAX = 10;
/** 픽셀을 넣은 발송만 기록하며 사람과 기계의 상한은 독립적이다. */
export function shouldStoreOpen(input: {
    openTracked: boolean;
    isMachine: boolean;
    storedHuman: number;
    storedMachine: number;
}): boolean {
    return input.openTracked && (input.isMachine
        ? input.storedMachine < MACHINE_OPENS_PER_SEND_MAX
        : input.storedHuman < HUMAN_OPENS_PER_SEND_MAX);
}

export const OPEN_RATE_LIMIT = { maxRequests: 10, windowMs: 60_000 } as const;
export const OPEN_WRITE_CONCURRENCY = 4;

/** 시각 단위는 ms. 버린 요청이 있고 마지막 경고부터 60초 이상 지났을 때만 기록한다. */
export function shouldLogDroppedOpens(droppedCount: number, lastLoggedAt: number, now: number): boolean {
    return droppedCount > 0 && now - lastLoggedAt >= 60_000;
}
