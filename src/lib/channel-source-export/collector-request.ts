import {
    CHANNEL_EXPORT_VERSION,
    ChannelExportTransportError,
    type ChannelExportOptions,
} from "@/lib/customer-imports/channel-export";
import { ChannelSourceHttpError, type ChannelSourceRequest } from "./http";

export type ChannelSourcePage = {
    path: string;
    query: Record<string, string | number>;
    apiVersion: typeof CHANNEL_EXPORT_VERSION;
    status: 200;
    body: unknown;
};

export class ChannelSourceArchiveError extends Error {
    readonly code = "archive";
    constructor() {
        super("원본 응답을 보관하지 못해 수집을 중단했습니다.");
        this.name = "ChannelSourceArchiveError";
    }
}

/** Adapt retryable HTTP errors and durably archive pages before advancing a cursor. */
export function createChannelCollectorRequest(
    request: ChannelSourceRequest,
    options: {
        savePage?: (page: ChannelSourcePage) => Promise<unknown>;
        expectedChannelId?: string;
    } = {},
): ChannelExportOptions["request"] {
    if (options.savePage && !options.expectedChannelId)
        throw new ChannelSourceArchiveError();
    return async (input) => {
        let response;
        try {
            response = await request(input);
        } catch (error) {
            if (
                error instanceof ChannelSourceHttpError &&
                (error.code === "network" || error.code === "timeout")
            )
                throw new ChannelExportTransportError(error.code);
            throw error;
        }
        const channelProbeMatches = input.path !== "/open/channel" ||
            (response.body !== null && typeof response.body === "object" &&
                "channel" in response.body && response.body.channel !== null &&
                typeof response.body.channel === "object" &&
                "id" in response.body.channel &&
                response.body.channel.id === options.expectedChannelId);
        if (
            response.status === 200 &&
            channelProbeMatches &&
            !input.path.endsWith("/messages/file") &&
            options.savePage
        ) {
            try {
                await options.savePage({
                    path: input.path,
                    query: { ...input.query },
                    apiVersion: CHANNEL_EXPORT_VERSION,
                    status: 200,
                    body: structuredClone(response.body),
                });
            } catch {
                throw new ChannelSourceArchiveError();
            }
        }
        return response;
    };
}
