/**
 * 대기 파일 전체를 페이지를 넘기며 끝까지 처리한다(UX-095).
 * 처리한 파일은 대기 목록에서 빠지므로 같은 위치를 다시 읽고, 시도했는데 그대로 대기인 파일만 건너뛴다.
 * 매 반복은 새 파일을 하나 이상 시도하거나 읽는 위치를 앞으로 옮기므로 끝난다.
 */
export async function drainPendingFiles<T extends { id: string }>(options: {
    page: (offset: number) => Promise<{ rows: T[]; hasMore: boolean }>;
    fetch: (row: T) => Promise<unknown>;
    eligible: (row: T) => boolean;
    stopped: () => boolean;
    onProgress?: (done: number, failed: number) => void;
}) {
    const attempted = new Set<string>();
    let skip = 0,
        done = 0,
        failed = 0;
    for (;;) {
        const current = await options.page(skip);
        const todo = current.rows.filter(
            (r) => options.eligible(r) && !attempted.has(r.id),
        );
        if (!todo.length) {
            if (!current.hasMore || !current.rows.length) break;
            skip += current.rows.length;
            continue;
        }
        for (const row of todo) {
            if (options.stopped()) break;
            attempted.add(row.id);
            try {
                await options.fetch(row);
            } catch {
                failed++;
            }
            done++;
            options.onProgress?.(done, failed);
        }
        if (options.stopped()) break;
    }
    return { done, failed };
}
