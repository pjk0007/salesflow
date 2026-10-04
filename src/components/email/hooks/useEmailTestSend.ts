import { useState, useMemo, useEffect } from "react";
import { extractEmailVariables } from "@/lib/email-utils";
import { useSenderProfiles } from "@/hooks/useSenderProfiles";
import { useSignatures } from "@/hooks/useSignatures";

interface TestSendTemplate {
    id: number;
    subject: string;
    htmlBody: string | null;
}

interface TestSendResult {
    success: boolean;
    requestId?: string;
    error?: string;
}

export function useEmailTestSend(template: TestSendTemplate) {
    const { profiles, defaultProfile } = useSenderProfiles();
    const { signatures, defaultSignature } = useSignatures();

    const [recipientEmail, setRecipientEmail] = useState("");
    const [variables, setVariables] = useState<Record<string, string>>({});
    const [selectedProfileId, setSelectedProfileId] = useState<string>("");
    const [selectedSigId, setSelectedSigId] = useState<string>("");
    const [sending, setSending] = useState(false);
    const [result, setResult] = useState<TestSendResult | null>(null);

    useEffect(() => {
        if (defaultProfile && !selectedProfileId) setSelectedProfileId(String(defaultProfile.id));
    }, [defaultProfile, selectedProfileId]);

    useEffect(() => {
        if (defaultSignature && !selectedSigId) setSelectedSigId(String(defaultSignature.id));
    }, [defaultSignature, selectedSigId]);

    const variableNames = useMemo(
        () => extractEmailVariables(template.subject + (template.htmlBody || "")),
        [template.subject, template.htmlBody]
    );

    const previewSubject = useMemo(() => {
        let text = template.subject;
        for (const varName of variableNames) {
            text = text.replaceAll(varName, variables[varName] || varName);
        }
        return text;
    }, [template.subject, variableNames, variables]);

    const setVariable = (varName: string, value: string) => {
        setVariables((prev) => ({ ...prev, [varName]: value }));
    };

    const handleSend = async () => {
        if (!recipientEmail.includes("@")) return;
        setSending(true);
        setResult(null);
        try {
            const res = await fetch("/api/email/test-send", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    templateId: template.id,
                    recipientEmail,
                    variables: Object.keys(variables).length > 0 ? variables : undefined,
                    senderProfileId: selectedProfileId ? Number(selectedProfileId) : undefined,
                    // "none"은 명시적 "서명 없음"(null), 미선택은 미지정(undefined) — 서버가 구분한다
                    signatureId: selectedSigId === "none" ? null : selectedSigId ? Number(selectedSigId) : undefined,
                }),
            });
            const data = await res.json();
            setResult(data);
        } catch {
            setResult({ success: false, error: "요청에 실패했습니다." });
        } finally {
            setSending(false);
        }
    };

    const reset = () => {
        setResult(null);
        setSending(false);
        setSelectedProfileId(defaultProfile ? String(defaultProfile.id) : "");
        setSelectedSigId(defaultSignature ? String(defaultSignature.id) : "");
    };

    return {
        profiles,
        signatures,
        recipientEmail,
        setRecipientEmail,
        variables,
        variableNames,
        setVariable,
        selectedProfileId,
        setSelectedProfileId,
        selectedSigId,
        setSelectedSigId,
        previewSubject,
        sending,
        result,
        handleSend,
        reset,
    };
}
