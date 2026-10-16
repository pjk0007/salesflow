import { AsyncLocalStorage } from "node:async_hooks";
const origin = new AsyncLocalStorage<{ jobId: string; occurredAt?: Date }>();
export const importOrigin = () => origin.getStore();
export const withImportOrigin = <T>(
    value: { jobId: string; occurredAt?: Date },
    fn: () => Promise<T>,
) => origin.run(value, fn);
