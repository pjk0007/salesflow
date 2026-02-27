"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { useRouter } from "next/navigation";
import { useSession } from "@/contexts/SessionContext";
import { toast } from "sonner";
import { FIELD_TEMPLATES } from "@/lib/field-templates";
import OnboardingLayout from "@/components/onboarding/OnboardingLayout";
import WelcomeStep from "@/components/onboarding/WelcomeStep";
import WorkspaceStep from "@/components/onboarding/WorkspaceStep";
import FieldsStep from "@/components/onboarding/FieldsStep";
import InviteStep from "@/components/onboarding/InviteStep";
import CompleteStep from "@/components/onboarding/CompleteStep";
import { Loader2 } from "lucide-react";

const TOTAL_STEPS = 5;

export default function OnboardingPage() {
    const router = useRouter();
    const { user, isLoading: sessionLoading, refreshSession } = useSession();

    const [step, setStep] = useState(1);
    const [isLoading, setIsLoading] = useState(false);

    // Step 1
    const [orgName, setOrgName] = useState("");
    const [industry, setIndustry] = useState("");
    const [companySize, setCompanySize] = useState("");

    // Step 2
    const [workspaceName, setWorkspaceName] = useState("영업관리");
    const [workspaceIcon, setWorkspaceIcon] = useState("");
    const [workspaceId, setWorkspaceId] = useState<number | null>(null);

    // Step 3
    const [templateId, setTemplateId] = useState<string | null>(null);
    const [fieldsCreated, setFieldsCreated] = useState(0);

    // Step 4
    const [emails, setEmails] = useState(["", "", ""]);
    const [invitesSent, setInvitesSent] = useState(0);

    // 이미 온보딩 완료된 사용자는 홈으로
    useEffect(() => {
        if (!sessionLoading && !user) {
            router.push("/login");
        } else if (!sessionLoading && user?.onboardingCompleted) {
            router.push("/");
        }
    }, [sessionLoading, user, router]);

    // 가입 시 입력한 orgName 프리필 (한 번만)
    const orgFetched = useRef(false);
    useEffect(() => {
        if (user && !orgFetched.current) {
            orgFetched.current = true;
            fetch("/api/org/settings")
                .then((r) => r.json())
                .then((data) => {
                    if (data.success && data.data?.name) {
                        setOrgName(data.data.name);
                    }
                })
                .catch(() => {});
        }
    }, [user]);

    const handleSkipAll = useCallback(async () => {
        setIsLoading(true);
        try {
            await fetch("/api/org/onboarding-complete", { method: "POST" });
            await refreshSession();
            router.push("/");
        } catch {
            toast.error("오류가 발생했습니다.");
        } finally {
            setIsLoading(false);
        }
    }, [refreshSession, router]);

    const handleComplete = useCallback(async () => {
        setIsLoading(true);
        try {
            await fetch("/api/org/onboarding-complete", { method: "POST" });
            await refreshSession();
            router.push("/");
        } catch {
            toast.error("오류가 발생했습니다.");
        } finally {
            setIsLoading(false);
        }
    }, [refreshSession, router]);

    const handleNext = useCallback(async () => {
        setIsLoading(true);
        try {
            if (step === 1) {
                // 조직 정보 저장
                await fetch("/api/org", {
                    method: "PUT",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                        name: orgName.trim() || undefined,
                        industry: industry || undefined,
                        companySize: companySize || undefined,
                    }),
                });
                setStep(2);
            } else if (step === 2) {
                // 워크스페이스 생성
                if (!workspaceName.trim()) {
                    toast.error("워크스페이스 이름을 입력해주세요.");
                    return;
                }
                const res = await fetch("/api/workspaces", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                        name: workspaceName.trim(),
                        icon: workspaceIcon || undefined,
                    }),
                });
                const data = await res.json();
                if (data.success) {
                    setWorkspaceId(data.data.id);
                    setStep(3);
                } else {
                    toast.error(data.error || "워크스페이스 생성에 실패했습니다.");
                }
            } else if (step === 3) {
                // 필드 템플릿 적용
                if (templateId && workspaceId) {
                    const template = FIELD_TEMPLATES.find((t) => t.id === templateId);
                    if (template) {
                        const res = await fetch(`/api/workspaces/${workspaceId}/fields/bulk`, {
                            method: "POST",
                            headers: { "Content-Type": "application/json" },
                            body: JSON.stringify({ fields: template.fields }),
                        });
                        const data = await res.json();
                        if (data.success) {
                            setFieldsCreated(data.data.created);
                        }
                    }
                }
                setStep(4);
            } else if (step === 4) {
                // 멤버 초대
                const validEmails = emails.filter(
                    (e) => e.trim() && e.includes("@")
                );
                let sent = 0;
                for (const email of validEmails) {
                    const res = await fetch("/api/org/invitations", {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({ email: email.trim(), role: "member" }),
                    });
                    const data = await res.json();
                    if (data.success) sent++;
                }
                setInvitesSent(sent);
                setStep(5);
            }
        } catch {
            toast.error("오류가 발생했습니다.");
        } finally {
            setIsLoading(false);
        }
    }, [step, orgName, industry, companySize, workspaceName, workspaceIcon, templateId, workspaceId, emails]);

    const handleEmailChange = useCallback((index: number, value: string) => {
        setEmails((prev) => {
            const next = [...prev];
            next[index] = value;
            return next;
        });
    }, []);

    if (sessionLoading || (!user)) {
        return (
            <div className="flex min-h-screen items-center justify-center">
                <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
            </div>
        );
    }

    if (step === 5) {
        return (
            <OnboardingLayout
                currentStep={5}
                totalSteps={TOTAL_STEPS}
                onSkipAll={handleSkipAll}
                showNav={false}
            >
                <CompleteStep
                    workspaceName={workspaceId ? workspaceName : ""}
                    fieldsCreated={fieldsCreated}
                    invitesSent={invitesSent}
                    onStart={handleComplete}
                    isLoading={isLoading}
                />
            </OnboardingLayout>
        );
    }

    return (
        <OnboardingLayout
            currentStep={step}
            totalSteps={TOTAL_STEPS}
            onSkipAll={handleSkipAll}
            onPrev={step > 1 ? () => setStep(step - 1) : undefined}
            onNext={handleNext}
            nextLabel={step === 4 ? "완료" : "다음"}
            nextDisabled={step === 2 && !workspaceName.trim()}
            isLoading={isLoading}
        >
            {step === 1 && (
                <WelcomeStep
                    orgName={orgName}
                    industry={industry}
                    companySize={companySize}
                    onOrgNameChange={setOrgName}
                    onIndustryChange={setIndustry}
                    onCompanySizeChange={setCompanySize}
                />
            )}
            {step === 2 && (
                <WorkspaceStep
                    workspaceName={workspaceName}
                    workspaceIcon={workspaceIcon}
                    onNameChange={setWorkspaceName}
                    onIconChange={setWorkspaceIcon}
                />
            )}
            {step === 3 && (
                <FieldsStep
                    selectedTemplateId={templateId}
                    onSelect={setTemplateId}
                />
            )}
            {step === 4 && (
                <InviteStep
                    emails={emails}
                    onEmailChange={handleEmailChange}
                />
            )}
        </OnboardingLayout>
    );
}
