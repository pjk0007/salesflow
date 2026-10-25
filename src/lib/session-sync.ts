/**
 * 같은 브라우저의 다른 탭에서 조직 전환·로그아웃으로 세션 쿠키가 바뀌었는지 알아차린다 (UX-010).
 * 쿠키는 탭끼리 공유되지만 화면 상태는 공유되지 않아, 알리지 않으면 이전 조직 화면에
 * 새 조직 자료가 섞여 들어온다.
 */
export const SESSION_CHANGE_STORAGE_KEY = "sendb:session-changed";

interface SessionIdentitySource {
    orgId: string;
    userId: string;
    membershipId?: string | null;
    tokenVersion?: number | null;
    role: string;
    isSuperAdmin?: boolean;
}

/** 같은 조직에 다시 참여하거나 권한이 바뀐 세션도 다른 세션으로 본다. */
export function sessionIdentityKey(user: SessionIdentitySource): string {
    return [user.orgId, user.userId, user.membershipId, user.tokenVersion, user.role, user.isSuperAdmin === true].join(":");
}

/** 이 탭이 세션을 바꿨음을 다른 탭에 알린다. 값에는 세션 정보를 넣지 않는다. */
export function announceSessionChange(storage?: Pick<Storage, "setItem">): void {
    try {
        (storage ?? globalThis.localStorage)?.setItem(SESSION_CHANGE_STORAGE_KEY, `${Date.now()}:${Math.random().toString(36).slice(2)}`);
    } catch {
        // 저장소를 쓸 수 없는 환경(사생활 보호 모드 등)은 탭 복귀 시 확인으로 대신한다.
    }
}

interface SessionWatchTarget {
    addEventListener(type: string, listener: (event: Event) => void): void;
    removeEventListener(type: string, listener: (event: Event) => void): void;
    document?: { visibilityState?: string };
}

/**
 * 다른 탭의 알림(storage)은 바로, 탭 복귀(focus·visibilitychange)는 짧은 간격으로 묶어 확인을 요청한다.
 * 반환값은 구독 해제 함수다.
 */
export function watchSessionChanges(
    target: SessionWatchTarget,
    check: () => void,
    options: { minIntervalMs?: number; now?: () => number } = {},
): () => void {
    const minIntervalMs = options.minIntervalMs ?? 2_000;
    const now = options.now ?? Date.now;
    let lastReturnCheck = -Infinity;
    const onStorage = (event: Event) => {
        if ((event as StorageEvent).key === SESSION_CHANGE_STORAGE_KEY) check();
    };
    const onReturn = (event: Event) => {
        if (event.type === "visibilitychange" && target.document?.visibilityState !== "visible") return;
        const at = now();
        if (at - lastReturnCheck < minIntervalMs) return;
        lastReturnCheck = at;
        check();
    };
    target.addEventListener("storage", onStorage);
    target.addEventListener("focus", onReturn);
    target.addEventListener("visibilitychange", onReturn);
    return () => {
        target.removeEventListener("storage", onStorage);
        target.removeEventListener("focus", onReturn);
        target.removeEventListener("visibilitychange", onReturn);
    };
}
