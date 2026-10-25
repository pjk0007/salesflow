"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import useSWR from "swr";
import {
    ArrowLeft,
    ArrowUp,
    Home,
    MessageCircle,
    Plus,
    RotateCcw,
} from "lucide-react";
import { WelcomeProcess } from "@/components/customer-messenger/ui/WelcomeProcess";
import { ReplyContactForm } from "@/components/customer-messenger/ui/ReplyContactForm";
import type { MessengerBrand, PublicMessengerSettings } from "@/components/customer-messenger/types";
import { BrandMark } from "@/components/customer-messenger/ui/BrandMark";
import type { ReplyContactDraft } from "@/lib/customer-messenger/rules";
import { MessengerHome } from "@/components/customer-messenger/ui/MessengerHome";
import { inboxRequest, InboxRequestError } from "../api";
import type { SendbCustomerMessages } from "../../../../sdk/messenger";
import { useAttachmentDrafts } from "../hooks/useAttachmentDrafts";
import { AttachmentDrafts } from "./AttachmentDrafts";
import { AttachmentList } from "./AttachmentList";
import { draftSessionKey } from "../utils/session";
import { useJourneyAttachment } from "@/components/inbox-journey/hooks/useJourneyAttachment";
import { useCustomerConversations } from "@/components/customer-conversations/hooks/useCustomerConversations";
import { CustomerConversationList } from "@/components/customer-conversations/ui/CustomerConversationList";
import {
    customerConversationTimestamp,
    isReadOnlyCustomerConversation,
} from "@/components/customer-conversations/utils/presentation";
import { mergeCustomerDraftText } from "@/components/customer-conversations/utils/draft-text";
import { useAsyncConfirm } from "@/components/ui/alert-dialog";
type PendingMessage = { body: string; id: string; files: string };
type ConversationDraft = {
    text: string;
    suggestion: string;
    pending: PendingMessage | null;
    handoff: string | null;
};
type VisitorDetail = SendbCustomerMessages;
type CustomerMessage = VisitorDetail["messages"][number];
const conversationUuid =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function ChatWidget({
    channelKey,
    parentOrigin,
    pageUrl,
    brand,
}: {
    channelKey: string;
    parentOrigin?: string;
    pageUrl?: string;
    brand?: MessengerBrand;
}) {
    const ownerOrigin = useCallback(
        () =>
            parentOrigin ||
            new URLSearchParams(window.location.search).get("origin"),
        [parentOrigin],
    );
    const [isHome, setIsHome] = useState(true);
    const { confirm, confirmationDialog } = useAsyncConfirm();
    const [token, setToken] = useState(""),
        [ready, setReady] = useState(false),
        [name, setName] = useState(""),
        [email, setEmail] = useState("");
    const [text, setText] = useState(""),
        [busy, setBusy] = useState(false),
        [error, setError] = useState("");
    const [suggestedText, setSuggestedText] = useState("");
    const deferredDraft = useRef<string | null>(null);
    const [hasDeferredDraft, setHasDeferredDraft] = useState(false);
    const incomingDraft = useRef<(message: string) => void>(() => {});
    const textRef = useRef(text);
    useEffect(() => {
        textRef.current = text;
    }, [text]);
    const [older, setOlder] = useState<CustomerMessage[]>([]),
        [canLoad, setCanLoad] = useState(true);
    const [blocked, setBlocked] = useState(false);
    const [linking, setLinking] = useState(false);
    const [managed, setManaged] = useState(false),
        [opened, setOpened] = useState(true),
        [readId, setReadId] = useState(0);
    const generation = useRef(0);
    const [draftKey, setDraftKey] = useState("current");
    const drafts = useRef(new Map<string, ConversationDraft>());
    const [configuration, setConfiguration] = useState<{
        nonce: number;
        id?: number;
        token: string;
    } | null>(null);
    const configurationNonce = useRef(0);
    const configurationId = useRef<number | undefined>(undefined);
    const acknowledgedConfiguration = useRef(0);
    const loadedOrigin = useRef("");
    const navigation = useRef<(view: string, id?: string) => void>(() => {});
    const history = useCustomerConversations(channelKey, token, ready, opened);
    const markSeen = history.markSeen;
    const invalidateConversation = history.invalidate;
    const openConversation = history.open;
    const startInquiry = history.newInquiry;
    const isList = history.enabled && history.view === "list";
    const isNew = history.enabled && history.view === "new";
    const selectedId = history.enabled ? history.conversationId : undefined;
    const baseUrl = `/api/messenger/${channelKey}`;
    const selectedUrl = selectedId
        ? `${baseUrl}?conversationId=${encodeURIComponent(selectedId)}`
        : baseUrl;
    const handoffPending = useRef<string | null>(null);
    const replyContactDraft = useRef<{
        token: string;
        key: string;
        draft: ReplyContactDraft;
    } | null>(null);
    const [contactSeed, setContactSeed] = useState<{
        id: string;
        draft: ReplyContactDraft;
    } | null>(null);
    async function ensureSession(currentGeneration: number) {
        if (token) return token;
        const result = await inboxRequest<{ token: string }>(baseUrl, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                action: "session",
                name: name.trim() || "방문 고객",
                email: email.trim(),
                pageUrl: pageUrl || undefined,
            }),
        });
        if (currentGeneration !== generation.current) return "";
        configured.current = draftSessionKey(result.token);
        setToken(result.token);
        if (managed) parentMessage("sendb:session", { token: result.token });
        else
            try {
                localStorage.setItem(storageKey, result.token);
            } catch {}
        return result.token;
    }
    function contactSnapshot() {
        const c = replyContactDraft.current;
        return c?.token === token && c.key === draftKey ? c.draft : null;
    }
    async function savePendingContact(
        session: string,
        id: string | undefined,
        snapshot: ReplyContactDraft | null,
    ) {
        if (!snapshot) return;
        try {
            await inboxRequest(
                `${baseUrl}/contact${id ? `?conversationId=${encodeURIComponent(id)}` : ""}`,
                {
                    method: "POST",
                    headers: {
                        "Content-Type": "application/json",
                        Authorization: `Bearer ${session}`,
                    },
                    body: JSON.stringify(snapshot),
                },
            );
            setContactSeed(null);
            replyContactDraft.current = null;
        } catch {
            if (id) setContactSeed({ id, draft: snapshot });
            setError(
                "문의는 접수됐지만 연락처 저장을 확인하지 못했습니다. 연락처를 확인하고 다시 저장해주세요.",
            );
        }
    }
    async function requestHuman() {
        if (busy || linking || inquiryPending || !canWrite) return;
        if (isNew && pending.current) {
            setError(
                "먼저 작성한 메시지를 다시 보내 결과를 확인해주세요. 작성 내용은 보관되어 있습니다.",
            );
            return;
        }
        const currentGeneration = generation.current;
        setBusy(true);
        setError("");
        handoffPending.current ??= crypto.randomUUID();
        const snapshot = contactSnapshot();
        try {
            const session = await ensureSession(currentGeneration);
            if (!session || currentGeneration !== generation.current) return;
            const result = await inboxRequest<{ conversationId?: string }>(
                isNew ? `${baseUrl}/conversations` : selectedUrl,
                {
                    method: "POST",
                    headers: {
                        "Content-Type": "application/json",
                        Authorization: `Bearer ${session}`,
                    },
                    body: JSON.stringify({
                        clientId: handoffPending.current,
                        body: "상담원 연결을 부탁드립니다.",
                    }),
                },
            );
            if (currentGeneration !== generation.current) return;
            await savePendingContact(
                session,
                result.conversationId ?? selectedId,
                snapshot,
            );
            handoffPending.current = null;
            if (isNew && result.conversationId) {
                attachments.moveTo(`${channelKey}:${result.conversationId}`);
                drafts.current.delete("new");
                setDraftKey(result.conversationId);
                history.open(result.conversationId);
            } else await data.mutate();
            void history.refresh();
        } catch (e) {
            if (currentGeneration === generation.current)
                setError((e as Error).message);
        } finally {
            if (currentGeneration === generation.current) setBusy(false);
        }
    }
    const attachments = useAttachmentDrafts(`${channelKey}:${draftKey}`);
    const moveAttachments = useRef(attachments.moveTo);
    moveAttachments.current = attachments.moveTo;
    const resetAttachments = attachments.reset;
    const uploadUrl = `${baseUrl}/attachments${isNew ? "?newConversation=1" : selectedId ? `?conversationId=${encodeURIComponent(selectedId)}` : ""}`;
    const configured = useRef<string | null>(null);
    const [journeyToken, setJourneyToken] = useState<string | undefined>(
        undefined,
    );
    const pending = useRef<PendingMessage | null>(null),
        end = useRef<HTMLDivElement>(null),
        scroll = useRef<HTMLDivElement>(null),
        follow = useRef(true);
    const storageKey = `sendb-chat:${channelKey}`;
    const config = useSWR<{
        name: string;
        greeting: string;
        messengerSettings?: PublicMessengerSettings;
        color: string;
        allowedOrigins: string[];
        businessHours?: {
            open: boolean;
            nextOpenAt: string | null;
            timezone: string;
            awayMessage: string;
        } | null;
    }>(`/api/messenger/${channelKey}`, inboxRequest, {
        refreshInterval: 60000,
        refreshWhenHidden: false,
    });
    const data = useSWR<
        VisitorDetail & { configurationNonce: number; sessionToken: string }
    >(
        token && ready && !linking
            ? [selectedUrl, token, configuration?.nonce ?? 0]
            : null,
        async ([url, value, nonce]: [string, string, number]) => ({
            ...(await inboxRequest<VisitorDetail>(url, {
                headers: { Authorization: `Bearer ${value}` },
            })),
            configurationNonce: nonce,
            sessionToken: value,
        }),
        {
            refreshInterval: opened ? 3000 : 15000,
            refreshWhenHidden: false,
            shouldRetryOnError: (error) => !(error instanceof InboxRequestError && [401, 403, 404].includes(error.status)),
        },
    );
    const currentResolved =
        data.data?.sessionToken === token &&
        data.data?.configurationNonce === (configuration?.nonce ?? 0);
    const detailAccessDenied =
        data.error instanceof InboxRequestError &&
        [401, 403, 404].includes(data.error.status);
    const detailResolved =
        currentResolved &&
        !detailAccessDenied &&
        (!selectedId || data.data?.conversationId === selectedId);
    const selectedRow = history.rows.find((row) => row.id === selectedId);
    const readOnly =
        !isNew &&
        (isReadOnlyCustomerConversation(selectedRow) ||
            (detailResolved && isReadOnlyCustomerConversation(data.data)));
    const detailPending = history.enabled && !isNew && !detailResolved;
    const canWrite = !readOnly && !detailPending && !detailAccessDenied;
    useJourneyAttachment({
        channelKey,
        token,
        journeyToken,
        conversationId: detailResolved ? data.data?.conversationId : undefined,
        readOnly,
        ready: ready && !linking && !isNew && !isList && detailResolved,
    });
    const inquiryPending =
        history.enabled && history.view === "current" && !currentResolved;
    const navigationBusy = busy || linking || inquiryPending;
    incomingDraft.current = (message: string) => {
        setIsHome(false);
        if (
            history.enabled &&
            (readOnly || detailPending || linking || isList || busy)
        ) {
            deferredDraft.current = message;
            setHasDeferredDraft(true);
            return;
        }
        const next = mergeCustomerDraftText(
            textRef.current,
            suggestedText,
            message,
        );
        setText(next.text);
        setSuggestedText(next.suggestion);
    };
    useEffect(() => {
        if (history.enabled && detailAccessDenied && selectedId)
            invalidateConversation(selectedId);
    }, [
        history.enabled,
        detailAccessDenied,
        selectedId,
        invalidateConversation,
    ]);
    useEffect(() => {
        generation.current++;
        configured.current = null;
        drafts.current.clear();
        deferredDraft.current = null;
        setHasDeferredDraft(false);
        resetAttachments();
        pending.current = null;
        handoffPending.current = null;
        setDraftKey("current");
        setText("");
        setSuggestedText("");
        setOlder([]);
        setCanLoad(true);
        setBusy(false);
        setManaged(false);
        setIsHome(true);
        setConfiguration(null);
        try {
            setToken(localStorage.getItem(storageKey) ?? "");
        } catch {
            /* 저장이 제한되어도 현재 창에서는 상담 가능 */
        }
        setReady(true);
    }, [storageKey, resetAttachments]);
    useEffect(() => {
        if (!config.data || window.parent === window) return;
        const parent = ownerOrigin();
        if (!parent || !config.data.allowedOrigins.includes(parent))
            setBlocked(true);
        if (!parent || !config.data.allowedOrigins.includes(parent)) return;
        const listener = (event: MessageEvent) => {
            if (
                event.source !== window.parent ||
                event.origin !== parent ||
                event.data?.key !== channelKey
            )
                return;
            if (event.data.type === "sendb:configure") {
                setJourneyToken(
                    typeof event.data.journeyToken === "string"
                        ? event.data.journeyToken
                        : undefined,
                );
                if (
                    event.data.configurationId !== undefined &&
                    (!Number.isSafeInteger(event.data.configurationId) ||
                        event.data.configurationId < 1)
                )
                    return;
                const next =
                    typeof event.data.identityToken === "string"
                        ? event.data.identityToken
                        : typeof event.data.visitorToken === "string"
                          ? event.data.visitorToken
                          : "";
                setManaged(true);
                setLinking(false);
                setToken(next);
                setOpened(!!event.data.opened);
                setReadId(Number(event.data.readId) || 0);
                configurationId.current = event.data.configurationId;
                setConfiguration({
                    nonce: ++configurationNonce.current,
                    id: event.data.configurationId,
                    token: next,
                });
                const session = draftSessionKey(next);
                if (configured.current !== session) {
                    setIsHome(true);
                    generation.current++;
                    setBusy(false);
                    resetAttachments();
                    drafts.current.clear();
                    deferredDraft.current = null;
                    setHasDeferredDraft(false);
                    setDraftKey("current");
                    if (!event.data.continueAnonymous) setText("");
                    if (!event.data.continueAnonymous) setSuggestedText("");
                    setOlder([]);
                    setCanLoad(true);
                    setError("");
                    if (!event.data.continueAnonymous || pending.current?.files)
                        pending.current = null;
                    if (!event.data.continueAnonymous)
                        handoffPending.current = null;
                    configured.current = session;
                }
            }
            if (event.data.type === "sendb:visibility") {
                setOpened(!!event.data.opened);
            }
            if (event.data.type === "sendb:journey-context")
                setJourneyToken(
                    typeof event.data.journeyToken === "string"
                        ? event.data.journeyToken
                        : undefined,
                );
            if (event.data.type === "sendb:linking")
                setLinking(!!event.data.linking);
            if (
                event.data.type === "sendb:navigate" &&
                event.data.configurationId === configurationId.current
            )
                navigation.current(event.data.view, event.data.conversationId);
            if (
                event.data.type === "sendb:draft" &&
                typeof event.data.message === "string" &&
                event.data.message.length <= 5000
            ) {
                incomingDraft.current(event.data.message);
            }
            if (event.data.type === "sendb:visitor-profile") {
                if (
                    typeof event.data.name === "string" &&
                    event.data.name.trim().length <= 100
                )
                    setName(event.data.name.trim());
                if (
                    typeof event.data.email === "string" &&
                    event.data.email.length <= 254
                )
                    setEmail(event.data.email);
            }
        };
        window.addEventListener("message", listener);
        if (loadedOrigin.current !== `${channelKey}:${parent}`) {
            loadedOrigin.current = `${channelKey}:${parent}`;
            window.parent.postMessage(
                { type: "sendb:loaded", key: channelKey },
                parent,
            );
        }
        return () => window.removeEventListener("message", listener);
    }, [config.data, channelKey, resetAttachments, ownerOrigin]);
    const parentMessage = useCallback(
        (type: string, payload: Record<string, unknown> = {}) => {
            if (!managed || window.parent === window) return;
            const parent = ownerOrigin();
            if (parent && config.data?.allowedOrigins.includes(parent))
                window.parent.postMessage(
                    {
                        type,
                        key: channelKey,
                        configurationId: configurationId.current,
                        ...payload,
                    },
                    parent,
                );
        },
        [managed, config.data, channelKey, ownerOrigin],
    );
    useEffect(() => {
        if (
            !managed ||
            !configuration ||
            token !== configuration.token ||
            acknowledgedConfiguration.current === configuration.nonce
        )
            return;
        // A new key forces a fresh request even for the same token. Never acknowledge
        // a new identity/configuration using a cached response from the previous one.
        if (
            (!token && config.data) ||
            (data.data?.sessionToken === token &&
                data.data.configurationNonce === configuration.nonce)
        ) {
            acknowledgedConfiguration.current = configuration.nonce;
            parentMessage("sendb:ready", { configurationId: configuration.id });
        } else if (data.error)
            parentMessage("sendb:error", {
                configurationId: configuration.id,
                message: data.error.message,
                status:
                    data.error instanceof InboxRequestError
                        ? data.error.status
                        : 500,
            });
    }, [
        managed,
        token,
        configuration,
        config.data,
        data.data,
        data.error,
        parentMessage,
    ]);
    const latestId = data.data?.messages.at(-1)?.id ?? 0;
    useEffect(() => {
        if (!managed || !data.data || history.enabled || linking) return;
        const reading = opened && !isHome;
        const unread = reading
            ? 0
            : data.data.messages.filter(
                  (m) => m.kind === "reply" && m.id > readId,
              ).length;
        if (reading && latestId > readId) {
            setReadId(latestId);
            parentMessage("sendb:read", { readId: latestId });
        }
        parentMessage("sendb:unread", { count: unread });
    }, [
        managed,
        opened,
        isHome,
        latestId,
        readId,
        data.data,
        history.enabled,
        linking,
        parentMessage,
    ]);
    useEffect(() => {
        if (managed && history.enabled && history.unreadCount !== undefined)
            parentMessage("sendb:unread", { count: history.unreadCount });
    }, [managed, history.enabled, history.unreadCount, parentMessage]);
    useEffect(() => {
        const id = data.data?.conversationId;
        if (
            !history.enabled ||
            !opened ||
            isHome ||
            linking ||
            isList ||
            isNew ||
            readOnly ||
            !detailResolved ||
            !id ||
            !latestId
        )
            return;
        let cancelled = false;
        let timer: ReturnType<typeof setTimeout> | undefined;
        const mark = () => {
            if (cancelled || document.visibilityState !== "visible") return;
            void markSeen(id, latestId, data.data?.readRevision).catch(() => {
                if (!cancelled) timer = setTimeout(mark, 5000);
            });
        };
        mark();
        document.addEventListener("visibilitychange", mark);
        return () => {
            cancelled = true;
            clearTimeout(timer);
            document.removeEventListener("visibilitychange", mark);
        };
    }, [
        history.enabled,
        markSeen,
        opened,
        isHome,
        linking,
        isList,
        isNew,
        readOnly,
        detailResolved,
        latestId,
        data.data?.conversationId,
        data.data?.readRevision,
    ]);
    useEffect(() => {
        if (
            !config.data?.messengerSettings?.enabled ||
            !opened ||
            isHome ||
            isList ||
            isNew ||
            readOnly ||
            linking ||
            !detailResolved ||
            !data.data?.conversationId ||
            !latestId ||
            !token
        )
            return;
        const id = data.data.conversationId;
        const seen = () => {
            if (document.visibilityState === "visible")
                void inboxRequest(
                    `${baseUrl}/contact?conversationId=${encodeURIComponent(id)}`,
                    {
                        method: "POST",
                        headers: {
                            "Content-Type": "application/json",
                            Authorization: `Bearer ${token}`,
                        },
                        body: JSON.stringify({
                            action: "seen",
                            messageId: latestId,
                        }),
                    },
                ).catch(() => {});
        };
        seen();
        document.addEventListener("visibilitychange", seen);
        return () => document.removeEventListener("visibilitychange", seen);
    }, [
        config.data?.messengerSettings?.enabled,
        opened,
        isHome,
        isList,
        isNew,
        readOnly,
        linking,
        detailResolved,
        data.data?.conversationId,
        latestId,
        token,
        baseUrl,
    ]);
    const lastMessageId = data.data?.messages.at(-1)?.id;
    useEffect(() => {
        if (!isHome && !isNew && lastMessageId && follow.current)
            end.current?.scrollIntoView({ block: "end" });
    }, [lastMessageId, opened, isHome, isNew]);
    function changeConversation(view: string, id?: string) {
        if (!history.enabled || navigationBusy) {
            parentMessage("sendb:error", {
                message: inquiryPending
                    ? "기존 문의를 먼저 확인한 뒤 다시 선택해주세요. 작성 내용은 보관되어 있습니다."
                    : "전송 또는 회원 연결을 마친 뒤 다시 선택해주세요.",
                status: 409,
            });
            return;
        }
        if (view === "list") {
            setIsHome(false);
            history.showList();
            return;
        }
        if (
            view !== "new" &&
            (view !== "thread" || !id || !conversationUuid.test(id))
        ) {
            parentMessage("sendb:error", {
                message: "문의 정보를 확인해주세요.",
                status: 400,
            });
            return;
        }
        let from = draftKey;
        setIsHome(false);
        const target = view === "new" ? "new" : id!;
        try {
            if (from === "current" && currentResolved) {
                from = data.data?.conversationId ?? "new";
                attachments.moveTo(`${channelKey}:${from}`);
            }
            drafts.current.set(from, {
                text,
                suggestion: suggestedText,
                pending: pending.current,
                handoff: handoffPending.current,
            });
            const next = drafts.current.get(target);
            const nextText =
                target === "new" && deferredDraft.current !== null
                    ? mergeCustomerDraftText(
                          next?.text ?? "",
                          next?.suggestion ?? "",
                          deferredDraft.current,
                      )
                    : {
                          text: next?.text ?? "",
                          suggestion: next?.suggestion ?? "",
                      };
            generation.current++;
            setDraftKey(target);
            setText(nextText.text);
            setSuggestedText(nextText.suggestion);
            if (target === "new") {
                deferredDraft.current = null;
                setHasDeferredDraft(false);
            }
            pending.current = next?.pending ?? null;
            handoffPending.current = next?.handoff ?? null;
            setOlder([]);
            setCanLoad(true);
            setError("");
            follow.current = true;
            if (view === "new") history.newInquiry();
            else history.open(id!);
        } catch (error) {
            setError((error as Error).message);
        }
    }
    navigation.current = changeConversation;
    // Pin the first resolved member inquiry. Another device starting a new
    // inquiry must not silently change the destination of this draft.
    useEffect(() => {
        const id = data.data?.conversationId;
        if (
            !history.enabled ||
            history.view !== "current" ||
            !currentResolved ||
            busy ||
            linking
        )
            return;
        const target = id ?? "new";
        if (draftKey === "current") {
            try {
                moveAttachments.current(`${channelKey}:${target}`);
                setDraftKey(target);
            } catch (error) {
                setError((error as Error).message);
                return;
            }
        }
        if (id) openConversation(id);
        else startInquiry();
    }, [
        history.enabled,
        history.view,
        openConversation,
        startInquiry,
        currentResolved,
        channelKey,
        data.data?.conversationId,
        draftKey,
        busy,
        linking,
    ]);
    useEffect(() => {
        if (
            data.error &&
            configuration &&
            acknowledgedConfiguration.current === configuration.nonce
        )
            parentMessage("sendb:error", {
                message: data.error.message,
                status:
                    data.error instanceof InboxRequestError
                        ? data.error.status
                        : 500,
            });
    }, [data.error, configuration, parentMessage]);
    const baseError = config.error?.message;
    if (baseError || blocked)
        return (
            <div className="flex h-dvh items-center justify-center bg-white p-8 text-center text-sm text-gray-500">
                {blocked
                    ? "이 사이트에는 상담창이 설치되어 있지 않습니다."
                    : baseError}
            </div>
        );
    const color = config.data?.color ?? "#635BFF";
    async function send() {
        if (
            busy ||
            linking ||
            inquiryPending ||
            !canWrite ||
            (!text.trim() && !attachments.files.length)
        )
            return;
        if (isNew && handoffPending.current) {
            setError(
                "상담원 연결 요청을 다시 눌러 결과를 확인해주세요. 작성 내용은 보관되어 있습니다.",
            );
            return;
        }
        const body = text.trim();
        const snapshot = contactSnapshot();
        setBusy(true);
        setError("");
        const currentGeneration = generation.current;
        if (
            pending.current?.body !== body ||
            pending.current?.files !== attachments.signature
        )
            pending.current = {
                body,
                id: crypto.randomUUID(),
                files: attachments.signature,
            };
        try {
            let session = token;
            if (!session) {
                const result = await inboxRequest<{ token: string }>(
                    `/api/messenger/${channelKey}`,
                    {
                        method: "POST",
                        body: JSON.stringify({
                            action: "session",
                            name: name.trim() || "방문 고객",
                            email: email.trim(),
                            pageUrl:
                                pageUrl ||
                                new URLSearchParams(window.location.search).get(
                                    "page",
                                ) ||
                                undefined,
                        }),
                        headers: { "Content-Type": "application/json" },
                    },
                );
                if (currentGeneration !== generation.current) return;
                session = result.token;
                // First anonymous session belongs to the current draft; parent echo must not reset it.
                configured.current = draftSessionKey(session);
                setToken(session);
                if (managed) parentMessage("sendb:session", { token: session });
                else
                    try {
                        localStorage.setItem(storageKey, session);
                    } catch {
                        /* 현재 창 세션 유지 */
                    }
            }
            const attachmentIds = await attachments.prepare(
                uploadUrl,
                "customer",
                { Authorization: `Bearer ${session}` },
            );
            if (currentGeneration !== generation.current) return;
            const result = await inboxRequest<{ conversationId?: string }>(
                isNew ? `${baseUrl}/conversations` : selectedUrl,
                {
                    method: "POST",
                    body: JSON.stringify({
                        clientId: pending.current!.id,
                        body,
                        attachmentIds,
                    }),
                    headers: {
                        "Content-Type": "application/json",
                        Authorization: `Bearer ${session}`,
                    },
                },
            );
            if (currentGeneration !== generation.current) return;
            await savePendingContact(
                session,
                result.conversationId ?? selectedId,
                snapshot,
            );
            setText("");
            attachments.clear();
            pending.current = null;
            follow.current = true;
            if (isNew && result.conversationId) {
                drafts.current.delete("new");
                setDraftKey(result.conversationId);
                history.open(result.conversationId);
            } else await data.mutate();
            void history.refresh();
        } catch (e) {
            if (currentGeneration === generation.current)
                setError((e as Error).message);
        } finally {
            if (currentGeneration === generation.current) setBusy(false);
        }
    }
    const messages =
        isNew || linking || !detailResolved
            ? []
            : [
                  ...older.filter(
                      (o) => !data.data?.messages.some((m) => m.id === o.id),
                  ),
                  ...(data.data?.messages ?? []),
              ].filter(
                  (message) =>
                      message.kind === "customer" || message.kind === "reply",
              );
    const unreadCount = history.enabled
        ? (history.unreadCount ?? 0)
        : (data.data?.messages.filter(
              (message) => message.kind === "reply" && message.id > readId,
          ).length ?? 0);
    function showConversations() {
        if (navigationBusy) return;
        if (history.enabled) changeConversation("list");
        else setIsHome(false);
    }
    return (
        <div className="flex h-dvh flex-col bg-white font-sans text-gray-900">
            {isHome ? (
                <MessengerHome
                    brand={brand}
                    name={config.data?.name ?? "고객 상담"}
                    greeting={config.data?.greeting ?? ""}
                    settings={config.data?.messengerSettings}
                    customerName={data.data?.profile.name}
                    color={color}
                    businessHours={config.data?.businessHours}
                    busy={navigationBusy}
                    loading={!config.data}
                    returning={
                        !history.enabled &&
                        !!token &&
                        detailResolved &&
                        messages.length > 0
                    }
                    unread={unreadCount}
                    hasConversations={
                        history.enabled
                            ? history.rows.length > 0
                            : !!token && detailResolved && messages.length > 0
                    }
                    onStart={() => {
                        if (navigationBusy) return;
                        if (history.enabled) changeConversation("new");
                        else setIsHome(false);
                    }}
                    onConversations={showConversations}
                />
            ) : (
                <>
                    <header className="flex shrink-0 items-center gap-3 border-b border-gray-100 bg-white px-4 py-4">
                        <button
                            type="button"
                            aria-label="상담 홈으로"
                            onClick={() => setIsHome(true)}
                            className="rounded-xl p-2 text-gray-500 hover:bg-gray-50"
                        >
                            <ArrowLeft size={20} aria-hidden="true" />
                        </button>
                        <div className="min-w-0 flex-1">
                            <h1 className="truncate text-sm font-semibold">
                                <BrandMark brand={brand} name={config.data?.name ?? "고객 상담"} />
                            </h1>
                            <p className="mt-1 text-xs text-gray-400">
                                {isList
                                    ? "남긴 문의와 답변"
                                    : readOnly
                                      ? "이전 상담 · 읽기 전용"
                                      : !isNew && detailResolved && data.data?.aiState === "human"
                                        ? "담당자 상담 · 연결 요청 접수"
                                        : config.data?.messengerSettings?.aiAvailable
                                          ? "AI 상담원 · 24시간 안내"
                                          : "담당자에게 문의를 남겨주세요"}
                            </p>
                        </div>
                        {history.enabled && (
                            <button
                                type="button"
                                aria-label="새 문의"
                                disabled={navigationBusy}
                                onClick={() => changeConversation("new")}
                                className="rounded-xl p-2 disabled:opacity-50"
                                style={{ color }}
                            >
                                <Plus size={20} aria-hidden="true" />
                            </button>
                        )}
                    </header>
                    {hasDeferredDraft && (
                        <div
                            role="status"
                            className="shrink-0 border-b bg-blue-50 px-4 py-3 text-xs text-blue-900"
                        >
                            <p>
                                사이트에서 전달한 문구를 새 문의 초안으로
                                보관했습니다. 새 문의를 열어 내용을 확인한 뒤
                                직접 보내주세요.
                            </p>
                            <button
                                type="button"
                                disabled={navigationBusy || !history.enabled}
                                onClick={() => changeConversation("new")}
                                className="mt-2 underline disabled:opacity-50"
                            >
                                새 문의 초안 열기
                            </button>
                        </div>
                    )}
                    {isList ? (
                        <CustomerConversationList
                            embedded
                            history={history}
                            busy={navigationBusy}
                            onOpen={(id) => changeConversation("thread", id)}
                            onNew={() => changeConversation("new")}
                            onBack={() => {
                                if (draftKey === "new") history.newInquiry();
                                else if (conversationUuid.test(draftKey))
                                    history.open(draftKey);
                                else history.reset();
                            }}
                        />
                    ) : (
                        <>
                            <div
                                ref={scroll}
                                onScroll={() => {
                                    const el = scroll.current;
                                    if (el)
                                        follow.current =
                                            el.scrollHeight -
                                                el.scrollTop -
                                                el.clientHeight <
                                            80;
                                }}
                                className="min-h-0 flex-1 space-y-4 overflow-y-auto p-5"
                                role="log"
                                aria-label="고객 상담 대화"
                            >
                                {config.data?.messengerSettings?.enabled &&
                                    !readOnly &&
                                    (!detailPending || isNew) && (
                                        <>
                                            {messages.length === 0 && (
                                                <WelcomeProcess
                                                    settings={
                                                        config.data
                                                            .messengerSettings
                                                    }
                                                    customerName={
                                                        data.data?.profile.name
                                                    }
                                                    greeting={
                                                        config.data.greeting
                                                    }
                                                    compact
                                                />
                                            )}
                                            <ReplyContactForm
                                                key={`${draftSessionKey(token)}:${draftKey}`}
                                                channelKey={channelKey}
                                                token={token}
                                                conversationId={
                                                    isNew
                                                        ? undefined
                                                        : detailResolved
                                                          ? data.data
                                                                ?.conversationId
                                                          : undefined
                                                }
                                                profile={data.data?.profile}
                                                emailAvailable={
                                                    config.data
                                                        .messengerSettings
                                                        .emailNotifications
                                                }
                                                initialDraft={
                                                    contactSeed &&
                                                    contactSeed.id ===
                                                        data.data
                                                            ?.conversationId
                                                        ? contactSeed.draft
                                                        : null
                                                }
                                                onDraft={(draft) => {
                                                    replyContactDraft.current =
                                                        draft
                                                            ? {
                                                                  token,
                                                                  key: draftKey,
                                                                  draft,
                                                              }
                                                            : null;
                                                }}
                                            />
                                        </>
                                    )}
                                {detailPending && !data.error && (
                                    <p
                                        role="status"
                                        className="text-xs text-gray-500"
                                    >
                                        문의를 확인하고 있습니다. 작성 중인
                                        내용은 보관됩니다.
                                    </p>
                                )}
                                {readOnly && (
                                    <div
                                        className="rounded-2xl bg-gray-50 p-4 text-sm text-gray-600"
                                        role="status"
                                        aria-label="이전 상담 안내"
                                    >
                                        <h2 className="font-semibold text-gray-900">
                                            이전 상담 · 읽기 전용
                                        </h2>
                                        <p className="mt-1">
                                            이전에 나눈 공개 대화와 첨부파일을
                                            확인할 수 있습니다. 이 기록에는
                                            메시지를 보내거나 상담원을 요청할 수
                                            없습니다. 추가로 궁금한 점은 새
                                            문의로 남겨주세요.
                                        </p>
                                    </div>
                                )}
                                {data.error && (
                                    <div
                                        role="alert"
                                        className="space-y-2 rounded-xl bg-red-50 p-3 text-xs text-red-700"
                                    >
                                        <p>{data.error.message}</p>
                                        <button
                                            onClick={() => {
                                                void data.mutate();
                                            }}
                                        >
                                            다시 불러오기
                                        </button>
                                        {detailAccessDenied && <button
                                            className="ml-4"
                                            onClick={() => {
                                                if (
                                                    managed &&
                                                    token.includes(".")
                                                ) {
                                                    parentMessage(
                                                        "sendb:refresh",
                                                    );
                                                    return;
                                                }
                                                const expectedGeneration = generation.current;
                                                confirm({
                                                    title: "새 문의를 시작할까요?",
                                                    description: "이전 대화는 이 브라우저에서 다시 볼 수 없습니다. 작성 중인 초안과 첨부도 지워집니다.",
                                                    confirmLabel: "새 문의 시작",
                                                    onConfirm: async () => {
                                                        if (expectedGeneration !== generation.current) return;
                                                        generation.current++;
                                                        attachments.reset();
                                                        drafts.current.clear();
                                                        deferredDraft.current = null;
                                                        setHasDeferredDraft(false);
                                                        setDraftKey("current");
                                                        pending.current = null;
                                                        handoffPending.current = null;
                                                        setText("");
                                                        setSuggestedText("");
                                                        setToken("");
                                                        setOlder([]);
                                                        setCanLoad(true);
                                                        try {
                                                            localStorage.removeItem(storageKey);
                                                        } catch {}
                                                    },
                                                });
                                            }}
                                        >
                                            {managed && token.includes(".")
                                                ? "회원 다시 연결"
                                                : "새 문의 시작"}
                                        </button>}
                                        {confirmationDialog}
                                    </div>
                                )}
                                {!isNew &&
                                    detailResolved &&
                                    data.data?.hasOlder &&
                                    canLoad && (
                                        <button
                                            className="w-full text-xs text-gray-500"
                                            onClick={async () => {
                                                const currentGeneration =
                                                    generation.current;
                                                try {
                                                    const result =
                                                        await inboxRequest<{
                                                            messages: CustomerMessage[];
                                                            hasOlder: boolean;
                                                        }>(
                                                            `${selectedUrl}${selectedId ? "&" : "?"}before=${messages[0]?.id}`,
                                                            {
                                                                headers: {
                                                                    Authorization: `Bearer ${token}`,
                                                                },
                                                            },
                                                        );
                                                    if (
                                                        currentGeneration !==
                                                        generation.current
                                                    )
                                                        return;
                                                    follow.current = false;
                                                    setOlder((o) => [
                                                        ...result.messages,
                                                        ...o,
                                                    ]);
                                                    setCanLoad(result.hasOlder);
                                                } catch (e) {
                                                    if (
                                                        currentGeneration ===
                                                        generation.current
                                                    )
                                                        setError(
                                                            (e as Error)
                                                                .message,
                                                        );
                                                }
                                            }}
                                        >
                                            이전 메시지 보기
                                        </button>
                                    )}
                                {(isNew || (!token && !messages.length)) && (
                                    <div className="rounded-2xl bg-gray-50 p-4 text-sm text-gray-600">
                                        <h2 className="font-semibold text-gray-900">
                                            {config.data?.messengerSettings?.aiAvailable ? "안녕하세요, AI 상담원입니다 🙂" : "무엇이 궁금하신가요?"}
                                        </h2>
                                        <p className="mt-1">
                                            {config.data?.messengerSettings?.aiAvailable
                                                ? "궁금한 점을 남겨주시면 바로 안내할게요. 담당자 상담이 필요하면 아래에서 연결을 요청해주세요."
                                                : "편하게 질문을 남겨주세요. 이 대화에서 답변드릴게요."}
                                        </p>
                                    </div>
                                )}
                                {!token &&
                                    !config.data?.messengerSettings
                                        ?.enabled && (
                                        <details className="space-y-3 rounded-2xl border border-gray-100 bg-gray-50/70 p-4">
                                            <summary className="cursor-pointer text-xs font-medium text-gray-500">
                                                이름·이메일 남기기 (선택)
                                            </summary>
                                            <label className="block text-xs text-gray-500">
                                                이름 (선택)
                                                <input
                                                    aria-label="방문자 이름"
                                                    value={name}
                                                    maxLength={100}
                                                    onChange={(e) =>
                                                        setName(e.target.value)
                                                    }
                                                    className="mt-1.5 w-full rounded-xl border border-gray-200 bg-white px-3 py-2.5 text-sm text-gray-900"
                                                    placeholder="이름 또는 닉네임"
                                                />
                                            </label>
                                            <label className="block text-xs text-gray-500">
                                                이메일 (선택)
                                                <input
                                                    aria-label="방문자 이메일"
                                                    type="email"
                                                    value={email}
                                                    maxLength={254}
                                                    onChange={(e) =>
                                                        setEmail(e.target.value)
                                                    }
                                                    className="mt-1.5 w-full rounded-xl border border-gray-200 bg-white px-3 py-2.5 text-sm text-gray-900"
                                                    placeholder="이메일 주소 (선택)"
                                                />
                                            </label>
                                            <p className="text-[10px] leading-relaxed text-gray-400">
                                                이름과 연락처는 이 문의의
                                                상담·응대를 위해 저장됩니다.
                                                답변은 이 상담창에서
                                                확인해주세요.
                                            </p>
                                        </details>
                                    )}
                                {messages.map((m) => (
                                    <div
                                        className={`flex ${m.kind === "customer" ? "justify-end" : "justify-start"}`}
                                        key={m.id}
                                    >
                                        <div className="max-w-[85%]">
                                            <p
                                                className={`mb-1.5 text-[10px] text-gray-400 ${m.kind === "customer" ? "text-right" : ""}`}
                                            >
                                                {m.authorName} ·{" "}
                                                <time dateTime={m.createdAt}>
                                                    {readOnly
                                                        ? customerConversationTimestamp(
                                                              m.createdAt,
                                                          )
                                                        : new Date(
                                                              m.createdAt,
                                                          ).toLocaleTimeString(
                                                              "ko-KR",
                                                              {
                                                                  hour: "2-digit",
                                                                  minute: "2-digit",
                                                              },
                                                          )}
                                                </time>
                                            </p>
                                            {m.body && (
                                                <p
                                                    className={`whitespace-pre-wrap break-words rounded-2xl px-4 py-3 text-sm leading-relaxed ${m.kind === "customer" ? "rounded-tr-md text-white" : "rounded-tl-md bg-gray-100"}`}
                                                    style={
                                                        m.kind === "customer"
                                                            ? {
                                                                  backgroundColor:
                                                                      color,
                                                              }
                                                            : {}
                                                    }
                                                >
                                                    {m.body}
                                                </p>
                                            )}
                                            <AttachmentList
                                                files={m.attachments}
                                                url={(id) =>
                                                    `${baseUrl}/attachments/${id}${selectedId ? `?conversationId=${encodeURIComponent(selectedId)}` : ""}`
                                                }
                                                headers={{
                                                    Authorization: `Bearer ${token}`,
                                                }}
                                            />
                                        </div>
                                    </div>
                                ))}
                                <div ref={end} />
                            </div>
                            {!isNew &&
                                !readOnly &&
                                detailResolved &&
                                data.data?.status === "closed" && (
                                    <p className="bg-gray-50 px-5 py-2 text-center text-xs text-gray-500">
                                        상담이 종료되었습니다. 메시지를 보내면
                                        다시 연결됩니다.
                                    </p>
                                )}
                            {error && (
                                <p
                                    role="alert"
                                    className="px-5 pb-2 text-xs text-red-600"
                                >
                                    {error}
                                </p>
                            )}
                            {linking && (
                                <p
                                    role="status"
                                    className="px-4 text-sm text-gray-500"
                                >
                                    회원 상담 이력을 연결하고 있습니다…
                                </p>
                            )}
                            {config.data?.messengerSettings?.enabled &&
                                data.data?.aiState === "human" &&
                                !readOnly &&
                                !isNew && (
                                    <p
                                        role="status"
                                        className="border-t bg-violet-50 px-4 py-3 text-xs leading-5 text-violet-900"
                                    >
                                        {config.data.businessHours?.open
                                            ? "상담원 연결 요청을 접수했습니다 🙂 궁금하신 점을 미리 남겨주시면 더 빠른 상담이 가능해요."
                                            : "현재는 고객센터 운영시간 밖입니다. 문의를 미리 남겨주시면 다음 운영시간에 담당자가 이어서 안내드립니다."}
                                    </p>
                                )}
                            {(token ||
                                config.data?.messengerSettings?.enabled) &&
                                !readOnly && (
                                    <button
                                        type="button"
                                        disabled={
                                            busy ||
                                            linking ||
                                            inquiryPending ||
                                            !canWrite ||
                                            (!isNew &&
                                                data.data?.aiState ===
                                                    "human") ||
                                            detailAccessDenied
                                        }
                                        onClick={() => void requestHuman()}
                                        className="shrink-0 px-5 py-2 text-xs text-gray-500 underline disabled:no-underline"
                                    >
                                        {!isNew &&
                                        data.data?.aiState === "human"
                                            ? "상담원이 이어서 안내드립니다"
                                            : "상담원 연결 요청"}
                                    </button>
                                )}
                            {readOnly ? (
                                <div className="shrink-0 border-t border-gray-100 p-4">
                                    <button
                                        type="button"
                                        disabled={navigationBusy}
                                        onClick={() =>
                                            changeConversation("new")
                                        }
                                        className="w-full rounded-xl px-4 py-3 text-sm font-medium text-white disabled:opacity-50"
                                        style={{ backgroundColor: color }}
                                    >
                                        새 문의로 상담 시작하기
                                    </button>
                                </div>
                            ) : (
                                <form
                                    className="shrink-0 border-t border-gray-100 p-4"
                                    onSubmit={(e) => {
                                        e.preventDefault();
                                        void send();
                                    }}
                                >
                                    {suggestedText && (
                                        <div
                                            role="status"
                                            className="mb-3 rounded-xl bg-blue-50 p-3 text-xs text-blue-900"
                                        >
                                            <p>
                                                작성 중인 문장을 보관했습니다.
                                                신청 내용으로 바꿀까요?
                                            </p>
                                            <button
                                                type="button"
                                                className="mr-4 mt-2 underline"
                                                onClick={() => {
                                                    setText(suggestedText);
                                                    setSuggestedText("");
                                                }}
                                            >
                                                신청 내용으로 바꾸기
                                            </button>
                                            <button
                                                type="button"
                                                className="underline"
                                                onClick={() =>
                                                    setSuggestedText("")
                                                }
                                            >
                                                작성 중인 문장 유지
                                            </button>
                                        </div>
                                    )}
                                    <div className="flex items-end gap-2 rounded-2xl border border-gray-200 p-3">
                                        <textarea
                                            aria-label="문의 메시지"
                                            disabled={
                                                busy || linking || !canWrite
                                            }
                                            value={text}
                                            maxLength={5000}
                                            onChange={(e) =>
                                                setText(e.target.value)
                                            }
                                            placeholder="메시지를 입력해주세요"
                                            rows={2}
                                            onKeyDown={(e) => {
                                                if (
                                                    e.key === "Enter" &&
                                                    (e.ctrlKey || e.metaKey) &&
                                                    !e.nativeEvent.isComposing
                                                ) {
                                                    e.preventDefault();
                                                    void send();
                                                }
                                            }}
                                            className="min-w-0 flex-1 resize-none text-sm outline-none"
                                        />
                                        <button
                                            aria-label="문의 보내기"
                                            disabled={
                                                busy ||
                                                linking ||
                                                inquiryPending ||
                                                !canWrite ||
                                                (!text.trim() &&
                                                    !attachments.files
                                                        .length) ||
                                                !config.data ||
                                                detailAccessDenied
                                            }
                                            className="rounded-xl p-2.5 text-white disabled:opacity-40"
                                            style={{ backgroundColor: color }}
                                        >
                                            {busy ? (
                                                <RotateCcw
                                                    size={17}
                                                    className="animate-spin"
                                                />
                                            ) : (
                                                <ArrowUp size={17} />
                                            )}
                                        </button>
                                    </div>
                                    <AttachmentDrafts
                                        files={attachments.files}
                                        busy={
                                            busy ||
                                            linking ||
                                            !canWrite ||
                                            !config.data
                                        }
                                        progress={attachments.progress}
                                        onSelect={attachments.select}
                                        onRemove={(id) =>
                                            attachments.remove(id, uploadUrl, {
                                                Authorization: `Bearer ${token}`,
                                            })
                                        }
                                        onError={setError}
                                    />
                                </form>
                            )}
                        </>
                    )}
                </>
            )}
            <nav
                aria-label="상담창 메뉴"
                className="grid shrink-0 grid-cols-2 border-t border-gray-100 bg-white p-2"
            >
                <button
                    type="button"
                    aria-pressed={isHome}
                    onClick={() => setIsHome(true)}
                    className="flex flex-col items-center gap-1 rounded-xl py-2 text-[11px]"
                    style={{ color: isHome ? color : "#9ca3af" }}
                >
                    <Home size={20} aria-hidden="true" />홈
                </button>
                <button
                    type="button"
                    aria-pressed={!isHome}
                    disabled={navigationBusy || !config.data}
                    onClick={showConversations}
                    className="relative flex flex-col items-center gap-1 rounded-xl py-2 text-[11px] disabled:opacity-50"
                    style={{ color: !isHome ? color : "#9ca3af" }}
                >
                    <span className="relative">
                        <MessageCircle size={20} aria-hidden="true" />
                        {unreadCount > 0 && (
                            <span
                                className="absolute -right-3 -top-1 rounded-full px-1 text-[9px] text-white"
                                style={{ backgroundColor: color }}
                                aria-label={`안 읽은 답변 ${unreadCount}개`}
                            >
                                {unreadCount > 99 ? "99+" : unreadCount}
                            </span>
                        )}
                    </span>
                    대화
                </button>
            </nav>
        </div>
    );
}
