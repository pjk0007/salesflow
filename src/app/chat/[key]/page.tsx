import { ChatWidget } from "@/components/inbox/ui/ChatWidget";
export default async function PublicChatPage({
    params,
}: {
    params: Promise<{ key: string }>;
}) {
    return <ChatWidget channelKey={(await params).key} />;
}
