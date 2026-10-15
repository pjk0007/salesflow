import { inboxRequest, inboxWrite } from "@/components/inbox/api";
import type { ImportFile } from "../types";
export { inboxRequest as fileRequest, inboxWrite as fileWrite };
export function supplementFile(url: string, row: ImportFile, file: File) {
    const form = new FormData();
    form.set("file", file);
    form.set("id", row.id);
    form.set("version", String(row.version));
    return inboxRequest(url, { method: "POST", body: form });
}
