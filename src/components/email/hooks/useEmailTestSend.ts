import { useState, useMemo, useEffect } from "react";
import { extractEmailVariables } from "@/lib/email-utils";
import { useSenderProfiles } from "@/hooks/useSenderProfiles";
import { useSignatures } from "@/hooks/useSignatures";
import { useWorkspaces } from "@/hooks/useWorkspaces";
import { TEST_SEND_NO_WORKSPACE, testSendWorkspaceId } from "@/components/email/reply-to/utils/replyTo";

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
    // 답장 받을 주소(Reply-To)를 가져올 사업 (DESIGN-3). 템플릿은 조직 단위라 워크스페이스를 모른다 —
    // 하나뿐이면 서버가 그 값을 쓰므로 고르지 않고, 여럿일 때만 고르게 한다. 고르지 않으면 Reply-To 없이 보낸다
    const { workspaces } = useWorkspaces();
    const workspaceChoices = workspaces.length > 1 ? workspaces : [];

    const [recipientEmail, setRecipientEmail] = useState("");
    const [variables, setVariables] = useState<Record<string, string>>({});
    const [selectedProfileId, setSelectedProfileId] = useState<string>("");
    const [selectedSigId, setSelectedSigId] = useState<string>("");
    const [selectedWorkspaceId, setSelectedWorkspaceId] = useState<string>(TEST_SEND_NO_WORKSPACE);
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
                    workspaceId: testSendWorkspaceId(workspaces.map((ws) => ws.id), selectedWorkspaceId),
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
        setSelectedWorkspaceId(TEST_SEND_NO_WORKSPACE);
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
        workspaceChoices,
        selectedWorkspaceId,
        setSelectedWorkspaceId,
        previewSubject,
        sending,
        result,
        handleSend,
        reset,
    };
}
