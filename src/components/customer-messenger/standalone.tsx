import { createRoot } from "react-dom/client";
import { ChatWidget } from "@/components/inbox/ui/ChatWidget";
import { configureMessengerApiOrigin } from "./api-origin";

const script = document.currentScript as HTMLScriptElement | null;
const root = document.getElementById("sendb-messenger-root");
try {
    const embedded = document.documentElement.dataset;
    const requested = embedded.sendbChannel || new URLSearchParams(location.search).get("channel"), declared = script?.dataset.channel;
    const channel = declared || requested;
    if (!root || !channel || !/^[a-f0-9]{48}$/.test(channel) || (declared && requested && declared !== requested) || !script?.dataset.apiBase)
        throw new Error("configuration");
    configureMessengerApiOrigin(embedded.sendbApiBase || script.dataset.apiBase);
    createRoot(root).render(<ChatWidget channelKey={channel} parentOrigin={embedded.sendbParentOrigin} pageUrl={embedded.sendbPage} />);
} catch {
    if (root) { root.setAttribute("role", "alert"); root.textContent = "상담 연결 설정을 확인해주세요. 잠시 후 다시 연결해주세요."; }
}
