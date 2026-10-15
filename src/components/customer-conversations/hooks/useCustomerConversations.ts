"use client";
import { useEffect, useMemo, useSyncExternalStore } from "react";
import { draftSessionKey } from "@/components/inbox/utils/session";
import { customerConversationApi } from "../api";
import { CustomerConversationController } from "../utils/controller";

export function useCustomerConversations(
    channelKey: string,
    token: string,
    ready: boolean,
    opened: boolean,
) {
    const enabled = ready && token.split(".").length === 3 && token.split(".").every(Boolean);
    const owner = enabled ? draftSessionKey(token) : "";
    const controller = useMemo(
        () => new CustomerConversationController(customerConversationApi(channelKey)),
        // Member identity, rather than JWT rotation, determines selection/cache ownership.
        // eslint-disable-next-line react-hooks/exhaustive-deps
        [channelKey, owner, enabled],
    );
    const state = useSyncExternalStore(
        controller.subscribe,
        controller.getSnapshot,
        controller.getSnapshot,
    );
    useEffect(() => {
        if (!enabled) return;
        controller.activate(token);
        void controller.refresh();
        const refresh = () => {
            if (document.visibilityState === "visible") void controller.refresh();
        };
        const timer = window.setInterval(refresh, opened ? 3000 : 15000);
        document.addEventListener("visibilitychange", refresh);
        return () => {
            window.clearInterval(timer);
            document.removeEventListener("visibilitychange", refresh);
            controller.deactivate();
        };
    }, [controller, token, enabled, opened]);
    return {
        enabled,
        ...state,
        showList: controller.showList,
        newInquiry: controller.newInquiry,
        open: controller.open,
        reset: controller.reset,
        invalidate: controller.invalidate,
        refresh: controller.refresh,
        loadMore: controller.loadMore,
        markSeen: controller.markSeen,
    };
}
