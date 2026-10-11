/**
 * 도메인의 메일 받는 서버(MX) 조회 — 답장 받을 주소·발신 주소가 메일을 받을 수 있는지 화면에 알리는 데만 쓴다 (DESIGN-3 2·3절).
 * 발송을 막지 않는다. 저장도 막지 않는다 (DNS 일시 오류일 수 있다).
 *
 * - 짧은 시간 제한 (기본 2.5초) — 넘으면 "unknown"
 * - 도메인마다 프로세스 안에서 캐시: ok는 하루, none·unknown은 10분 (mxCacheTtlMs) — MX를 연결하면 10분 안에 화면 안내가 걷힌다.
 *   같은 도메인을 동시에 물으면 한 번만 조회한다
 * - 예약 도메인(.test·.example·.invalid·.localhost·example.com 등)은 조회하지 않고 "none" — 시험 환경이 바깥 DNS로 나가지 않는다
 * - 환경 변수 EMAIL_MX_LOOKUP=off 이면 조회하지 않고 "unknown" (바깥 망이 막힌 서버·시험 서버용)
 *
 * DB를 모른다. 시험은 resolveMx를 바꿔 끼워 바깥으로 나가지 않는다 (setMxResolverForTests).
 */
import { promises as dnsPromises } from "node:dns";
import {
    classifyMxError,
    classifyMxRecords,
    emailDomain,
    isReservedMailDomain,
    mxCacheTtlMs,
} from "@/lib/reply-to-rules";
import type { MxStatus } from "@/lib/reply-to-rules";

export type { MxStatus };

export const MX_LOOKUP_TIMEOUT_MS = 2500;
/** 캐시에 담는 도메인 수 상한 — 넘으면 가장 오래 넣은 도메인부터 버린다 */
const MX_CACHE_MAX_DOMAINS = 2000;

type MxRecords = Array<{ exchange: string; priority: number }>;
type ResolveMx = (domain: string) => Promise<MxRecords>;

const cache = new Map<string, { status: MxStatus; expiresAt: number }>();
const inflight = new Map<string, Promise<MxStatus>>();

let resolver: dnsPromises.Resolver | null = null;
function defaultResolveMx(domain: string): Promise<MxRecords> {
    // 다시 묻지 않는다(tries 1) — 화면 안내용이라 늦게 정확한 것보다 빨리 "확인 못 함"이 낫다
    if (!resolver) resolver = new dnsPromises.Resolver({ timeout: MX_LOOKUP_TIMEOUT_MS, tries: 1 });
    return resolver.resolveMx(domain);
}

let resolveMxImpl: ResolveMx = defaultResolveMx;

/** 시험 전용: 조회 함수를 바꿔 끼우고 캐시를 비운다. 인자 없이 부르면 원래 조회로 돌아간다 */
export function setMxResolverForTests(fn?: ResolveMx): void {
    resolveMxImpl = fn ?? defaultResolveMx;
    cache.clear();
    inflight.clear();
}

function lookupDisabled(): boolean {
    return (process.env.EMAIL_MX_LOOKUP ?? "").trim().toLowerCase() === "off";
}

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
    return new Promise<T>((resolve, reject) => {
        const timer = setTimeout(() => reject(Object.assign(new Error("MX lookup timeout"), { code: "ETIMEOUT" })), ms);
        if (typeof timer === "object" && timer && "unref" in timer) timer.unref();
        p.then(
            (v) => { clearTimeout(timer); resolve(v); },
            (e) => { clearTimeout(timer); reject(e); },
        );
    });
}

function remember(domain: string, status: MxStatus, now: number): void {
    cache.delete(domain);
    cache.set(domain, { status, expiresAt: now + mxCacheTtlMs(status) });
    while (cache.size > MX_CACHE_MAX_DOMAINS) {
        const oldest = cache.keys().next();
        if (oldest.done) break;
        cache.delete(oldest.value);
    }
}

/**
 * 도메인의 MX 상태. 던지지 않는다 — 조회 실패는 "unknown".
 * opts.now·timeoutMs는 시험용.
 */
export async function lookupDomainMx(
    rawDomain: string,
    opts: { now?: () => number; timeoutMs?: number } = {},
): Promise<MxStatus> {
    const domain = rawDomain.trim().toLowerCase().replace(/\.$/, "");
    if (!domain || !domain.includes(".")) return "unknown";
    if (isReservedMailDomain(domain)) return "none";
    if (lookupDisabled()) return "unknown";

    const now = opts.now ?? Date.now;
    const hit = cache.get(domain);
    if (hit && hit.expiresAt > now()) return hit.status;

    const running = inflight.get(domain);
    if (running) return running;

    const p = withTimeout(resolveMxImpl(domain), opts.timeoutMs ?? MX_LOOKUP_TIMEOUT_MS)
        .then(
            (records) => classifyMxRecords(records),
            (err: unknown) => classifyMxError((err as { code?: string } | null)?.code ?? null),
        )
        .then((status) => {
            remember(domain, status, now());
            return status;
        })
        .finally(() => {
            inflight.delete(domain);
        });
    inflight.set(domain, p);
    return p;
}

/** 이메일 주소의 도메인 MX. 주소가 없거나 형식이 아니면 null (조회하지 않음) */
export async function lookupEmailMx(email: string | null | undefined): Promise<MxStatus | null> {
    const domain = emailDomain(email);
    return domain ? lookupDomainMx(domain) : null;
}
