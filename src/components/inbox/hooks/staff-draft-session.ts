import type { AttachmentDraftOwner, AttachmentDraftState, FileDraft } from "./useAttachmentDrafts";

type PendingSend = { clientId: string; fingerprint: string; busy: boolean };
type Snapshot = AttachmentDraftState & {
    active: boolean;
    text: Record<string, string>;
    pending: Record<string, PendingSend | undefined>;
    completed: Record<string, number>;
};
const empty = (active = true): Snapshot => ({ active, groups: {}, progress: {}, text: {}, pending: {}, completed: {} });
const MAX_SESSION_FILES = 20;
const MAX_SESSION_BYTES = 100 * 1024 * 1024;

/** Owned by one mounted inbox/account/organization/channel, never a module cache. */
export class StaffDraftSession implements AttachmentDraftOwner {
    private value = empty();
    private listeners = new Set<() => void>();
    private epoch = 0;
    private active = true;
    private controller = new AbortController();
    constructor(readonly scope = "", enabled = true) {
        this.active = enabled;
        this.value = empty(enabled);
        if (!enabled) this.controller.abort();
    }
    readonly subscribe = (listener: () => void) => {
        this.listeners.add(listener);
        return () => { this.listeners.delete(listener); };
    };
    readonly getSnapshot = () => this.value;
    private publish(next: Snapshot) {
        this.value = next;
        for (const listener of this.listeners) listener();
    }
    // React StrictMode may set up the same mounted scope again after effect cleanup.
    activate() {
        if (!this.active) {
            this.active = true;
            this.controller = new AbortController();
            this.publish(empty());
        }
    }
    invalidate() {
        this.active = false;
        this.epoch++;
        this.controller.abort();
        this.publish(empty(false));
    }
    capture() {
        const epoch = this.epoch;
        const signal = this.controller.signal;
        const isCurrent = () => this.active && epoch === this.epoch && !signal.aborted;
        return {
            signal,
            isCurrent,
            assertCurrent: () => {
                if (!isCurrent()) throw new DOMException("상담 세션이 종료되었습니다.", "AbortError");
            },
        };
    }
    requestFailed(error: unknown) {
        const status = (error as { status?: number })?.status;
        if (status === 401 || status === 403) this.invalidate();
    }
    update(group: string, change: (files: FileDraft[]) => FileDraft[]) {
        this.capture().assertCurrent();
        const groups = { ...this.value.groups, [group]: change(this.value.groups[group] ?? []) };
        this.replaceGroups(groups);
    }
    replaceGroups(groups: Record<string, FileDraft[]>) {
        this.capture().assertCurrent();
        const files = Object.values(groups).flat();
        if (files.length > MAX_SESSION_FILES || files.reduce((total, draft) => total + draft.file.size, 0) > MAX_SESSION_BYTES)
            throw new Error("현재 상담함의 첨부 초안은 최대 20개, 합계 100MB까지 유지됩니다. 다른 문의의 파일을 보내거나 제거해주세요.");
        this.publish({ ...this.value, groups });
    }
    setProgress(group: string, progress: string) {
        this.capture().assertCurrent();
        this.publish({ ...this.value, progress: { ...this.value.progress, [group]: progress } });
    }
    reset = () => this.invalidate();
    setText(group: string, text: string) {
        this.capture().assertCurrent();
        this.publish({ ...this.value, text: { ...this.value.text, [group]: text } });
    }
    begin(group: string, fingerprint: string) {
        const lifetime = this.capture();
        lifetime.assertCurrent();
        const previous = this.value.pending[group];
        if (previous?.busy) return null;
        const clientId = previous?.fingerprint === fingerprint ? previous.clientId : crypto.randomUUID();
        const pending = { clientId, fingerprint, busy: true };
        this.publish({ ...this.value, pending: { ...this.value.pending, [group]: pending } });
        return {
            ...lifetime,
            clientId,
            finish: () => {
                if (!lifetime.isCurrent() || this.value.pending[group] !== pending) return;
                this.publish({ ...this.value, pending: { ...this.value.pending, [group]: { ...pending, busy: false } } });
            },
            complete: () => {
                lifetime.assertCurrent();
                if (this.value.pending[group] !== pending) return;
                this.publish({
                    ...this.value,
                    groups: { ...this.value.groups, [group]: [] },
                    text: { ...this.value.text, [group]: "" },
                    pending: { ...this.value.pending, [group]: undefined },
                    completed: { ...this.value.completed, [group]: (this.value.completed[group] ?? 0) + 1 },
                });
            },
        };
    }
}
