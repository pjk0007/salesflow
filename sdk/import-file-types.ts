export interface SendbImportFile {
    id: string;
    messageId: number;
    fileName: string;
    state: "pending" | "fetching" | "ready" | "failed" | "needs_source";
    active: boolean;
    metadataValid: boolean;
    version: number;
    attempts: number;
    expectedSize: number | null;
    expectedSha256: string | null;
    sourceHost: string | null;
    interrupted: boolean;
    error: string | null;
    attachmentId: string | null;
    locator: {
        originalId: string;
        key: string | null;
        index: number;
        conversationId: string;
        messageSourceId: string;
    };
}
export interface SendbImportFilePage {
    rows: SendbImportFile[];
    counts: {
        state: SendbImportFile["state"];
        active: boolean;
        count: number;
    }[];
    total: number;
    offset: number;
    hasMore: boolean;
}
