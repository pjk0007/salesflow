/** Serialize cookie-changing requests and keep consumers invalid until the queue drains. */
export class SessionTransitionQueue {
    private tail: Promise<void> = Promise.resolve();
    private pending = 0;
    private generation = 0;
    constructor(private onStart: () => void, private onIdle: () => void) {}

    run(action: (isLatest: () => boolean) => Promise<void>): Promise<void> {
        const generation = ++this.generation;
        this.pending++;
        this.onStart();
        const execute = async () => {
            try {
                await action(() => generation === this.generation);
            } finally {
                this.pending--;
                if (this.pending === 0) this.onIdle();
            }
        };
        const operation = this.tail.then(execute, execute);
        // A failed transition must not prevent a queued logout from running.
        this.tail = operation.catch(() => {});
        return operation;
    }
}
