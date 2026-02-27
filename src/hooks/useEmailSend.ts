import { useState } from "react";

export function useEmailSend() {
    const [isSending, setIsSending] = useState(false);

    const sendEmail = async (data: { templateLinkId: number; recordIds: number[] }) => {
        setIsSending(true);
        try {
            const res = await fetch("/api/email/send", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(data),
            });
            return await res.json();
        } finally {
            setIsSending(false);
        }
    };

    return { sendEmail, isSending };
}
