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
import { requestErrorMessage } from "@/lib/swr-fetcher";
import {
    applyOnboardingTemplate,
    completeOnboarding,
    createOnboardingInvites,
    saveOnboardingOrg,
    saveOnboardingWorkspace,
} from "@/components/onboarding/api";

const STEP_ERRORS: Record<number, string> = {
    1: "조직 정보를 저장하지 못했습니다. 다시 시도해주세요.",
    2: "워크스페이스를 저장하지 못했습니다. 다시 시도해주세요.",
    3: "속성 템플릿을 적용하지 못했습니다. 다시 시도해주세요.",
    4: "초대를 보내지 못했습니다. 다시 시도해주세요.",
};

const TOTAL_STEPS = 5;

export default function OnboardingPage() {
    const router = useRouter();
    const { user, isLoading: sessionLoading, refreshSession } = useSession();

    const [step, setStep] = useState(1);
    const [isLoading, setIsLoading] = useState(false);
    const submitPending = useRef(false);

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
    // 이미 적용한 템플릿은 뒤로 갔다 와도 다시 적용하지 않는다
    const [appliedTemplateId, setAppliedTemplateId] = useState<string | null>(null);

    // Step 4
    const [emails, setEmails] = useState(["", "", ""]);
    const [invitesSent, setInvitesSent] = useState(0);
    const [invitesUnsent, setInvitesUnsent] = useState(0);
    const [inviteFailures, setInviteFailures] = useState(0);
    const invitationResults = useRef<ReadonlyMap<string, boolean>>(new Map());

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
        if (submitPending.current) return;
        submitPending.current = true;
        setIsLoading(true);
        try {
            await completeOnboarding();
            await refreshSession();
            router.push("/");
        } catch (error) {
            toast.error(requestErrorMessage(error, "완료 처리에 실패했습니다. 다시 시도해주세요."));
        } finally {
            submitPending.current = false;
            setIsLoading(false);
        }
    }, [refreshSession, router]);

    const handleComplete = handleSkipAll;

    const handleNext = useCallback(async () => {
        if (submitPending.current) return;
        submitPending.current = true;
        setIsLoading(true);
        try {
            if (step === 1) {
                await saveOnboardingOrg({ name: orgName, industry, companySize });
                setStep(2);
            } else if (step === 2) {
                if (!workspaceName.trim()) {
                    toast.error("워크스페이스 이름을 입력해주세요.");
                    return;
                }
                // 이미 만든 워크스페이스면 이름·아이콘만 고친다(뒤로→다음 중복 생성 방지)
                setWorkspaceId(await saveOnboardingWorkspace({ workspaceId, name: workspaceName, icon: workspaceIcon }));
                setStep(3);
            } else if (step === 3) {
                const template = FIELD_TEMPLATES.find((t) => t.id === templateId);
                if (template && workspaceId && template.id !== appliedTemplateId) {
                    const result = await applyOnboardingTemplate(workspaceId, template.fields);
                    setAppliedTemplateId(template.id);
                    setFieldsCreated((previous) => previous + result.created);
                    if (result.skippedItems.length) {
                        toast.info(result.skippedItems.map((item) => `${item.key}: ${item.reason}`).join(" · "));
                    }
                }
                setStep(4);
            } else if (step === 4) {
                const { created, failures } = await createOnboardingInvites(emails, invitationResults.current);
                invitationResults.current = created;
                for (const failure of failures) {
                    toast.error(`${failure.email}: ${requestErrorMessage(failure.error, "초대를 만들지 못했습니다.")}`);
                }
                setInvitesSent(created.size);
                setInvitesUnsent([...created.values()].filter((sent) => !sent).length);
                setInviteFailures(failures.length);
                setStep(5);
            }
        } catch (error) {
            toast.error(requestErrorMessage(error, STEP_ERRORS[step] ?? "요청을 처리하지 못했습니다."));
            if (step === 3) toast.info("속성은 워크스페이스 설정 > 속성 타입 관리에서도 추가할 수 있습니다.");
        } finally {
            submitPending.current = false;
            setIsLoading(false);
        }
    }, [step, orgName, industry, companySize, workspaceName, workspaceIcon, templateId, appliedTemplateId, workspaceId, emails]);

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
                    invitesUnsent={invitesUnsent}
                    inviteFailures={inviteFailures}
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
