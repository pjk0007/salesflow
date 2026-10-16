import { AsyncLocalStorage } from "node:async_hooks";
const origin = new AsyncLocalStorage<string>();
export const workflowOrigin = () => origin.getStore();
export const withWorkflowOrigin = <T>(id: string, fn: () => Promise<T>) =>
    origin.run(id, fn);
