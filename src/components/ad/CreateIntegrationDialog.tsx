"use client";

import { useState, useEffect, useCallback } from "react";
import useSWR from "swr";
import { defaultFetcher } from "@/lib/swr-fetcher";
import { useAdPlatforms } from "@/hooks/useAdPlatforms";
import { useAdAccounts } from "@/hooks/useAdAccounts";
import { useAdLeadIntegrations } from "@/hooks/useAdLeadIntegrations";
import { useMetaPages } from "@/hooks/useMetaPages";
import { useMetaLeadForms } from "@/hooks/useMetaLeadForms";
import { useMetaLeadFormFields } from "@/hooks/useMetaLeadFormFields";
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
    DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import type { FieldDefinition } from "@/types";

type Step = 1 | 2 | 3 | 4;

const STEP_NAMES: Record<Step, string> = {
    1: "광고 소스 선택",
    2: "대상 파티션 선택",
    3: "필드 매핑",
    4: "기본값 설정",
};

interface Workspace {
    id: number;
    name: string;
    description: string | null;
    icon: string | null;
    defaultFieldTypeId: number | null;
}

interface Partition {
    id: number;
    name: string;
    folderId: number | null;
    workspaceId: number;
    fieldTypeId: number | null;
    displayOrder: number | null;
}

interface PartitionsResponse {
    success: boolean;
    data: {
        folders: Array<{
            id: number;
            name: string;
            partitions: Partition[];
        }>;
        ungrouped: Partition[];
    };
}

interface CreateIntegrationDialogProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    onCreated: () => void;
}

export default function CreateIntegrationDialog({
    open,
    onOpenChange,
    onCreated,
}: CreateIntegrationDialogProps) {
    // Step state
    const [step, setStep] = useState<Step>(1);
    const [saving, setSaving] = useState(false);

    // Step 1: Ad source
    const [platformId, setPlatformId] = useState<number | undefined>();
    const [adAccountId, setAdAccountId] = useState<number | undefined>();
    const [pageId, setPageId] = useState<string>("");
    const [formId, setFormId] = useState<string>("");

    // Step 2: Target partition
    const [workspaceId, setWorkspaceId] = useState<number | undefined>();
    const [partitionId, setPartitionId] = useState<number | undefined>();

    // Step 3: Field mappings
    const [fieldMappings, setFieldMappings] = useState<Record<string, string>>({});

    // Step 4: Default values
    const [defaultValues, setDefaultValues] = useState<Record<string, string>>({});

    // Data hooks
    const { platforms } = useAdPlatforms();
    const { accounts } = useAdAccounts(platformId);
    const { createIntegration } = useAdLeadIntegrations();
    const { pages } = useMetaPages(platformId);
    const { forms } = useMetaLeadForms(platformId, pageId || undefined);
    const { fields: formFields, isLoading: formFieldsLoading } = useMetaLeadFormFields(
        platformId,
        formId || undefined
    );

    const { data: workspacesData } = useSWR<{ success: boolean; data: Workspace[] }>(
        open ? "/api/workspaces" : null,
        defaultFetcher
    );
    const workspaces = workspacesData?.data || [];

    const { data: partitionsData } = useSWR<PartitionsResponse>(
        workspaceId ? `/api/workspaces/${workspaceId}/partitions` : null,
        defaultFetcher
    );
    const allPartitions: Partition[] = partitionsData?.data
        ? [
              ...partitionsData.data.ungrouped,
              ...partitionsData.data.folders.flatMap((f) => f.partitions),
          ]
        : [];

    const { data: resolvedFieldsData } = useSWR<{ success: boolean; data: FieldDefinition[] }>(
        partitionId ? `/api/partitions/${partitionId}/resolved-fields` : null,
        defaultFetcher
    );
    const dbFields = resolvedFieldsData?.data || [];

    // Derived
    const connectedPlatforms = platforms.filter((p) => p.status === "connected");
    const selectedPlatform = platforms.find((p) => p.id === platformId);
    const isMeta = selectedPlatform?.platform === "meta";
    const selectedAccount = accounts.find((a) => a.id === adAccountId);
    const selectedForm = forms.find((f) => f.id === formId);
    const selectedPartition = allPartitions.find((p) => p.id === partitionId);

    // Mapped DB field keys (used in step 3)
    const mappedDbKeys = new Set(Object.values(fieldMappings));
    // Unmapped DB fields for step 4
    const unmappedDbFields = dbFields.filter((f) => !mappedDbKeys.has(f.key));

    // Reset all state when dialog closes
    const resetState = useCallback(() => {
        setStep(1);
        setPlatformId(undefined);
        setAdAccountId(undefined);
        setPageId("");
        setFormId("");
        setWorkspaceId(undefined);
        setPartitionId(undefined);
        setFieldMappings({});
        setDefaultValues({});
        setSaving(false);
    }, []);

    useEffect(() => {
        if (!open) {
            resetState();
        }
    }, [open, resetState]);

    // Auto-select workspace linked to the ad account
    useEffect(() => {
        if (selectedAccount?.workspaceId) {
            setWorkspaceId(selectedAccount.workspaceId);
        }
    }, [selectedAccount?.workspaceId]);

    // Reset cascading selections
    const handlePlatformChange = (val: string) => {
        setPlatformId(Number(val));
        setAdAccountId(undefined);
        setPageId("");
        setFormId("");
    };

    const handleAdAccountChange = (val: string) => {
        setAdAccountId(Number(val));
        setPageId("");
        setFormId("");
    };

    const handlePageChange = (val: string) => {
        setPageId(val);
        setFormId("");
    };

    const handleWorkspaceChange = (val: string) => {
        setWorkspaceId(Number(val));
        setPartitionId(undefined);
    };

    // Step validation
    const canProceedStep1 = (): boolean => {
        if (!platformId || !adAccountId) return false;
        if (isMeta && (!pageId || !formId)) return false;
        return true;
    };

    const canProceedStep2 = (): boolean => {
        return !!workspaceId && !!partitionId;
    };

    const canProceedStep3 = (): boolean => {
        // At least one field mapping is required
        return Object.keys(fieldMappings).length > 0;
    };

    const handleNext = () => {
        if (step === 1 && canProceedStep1()) setStep(2);
        else if (step === 2 && canProceedStep2()) setStep(3);
        else if (step === 3 && canProceedStep3()) {
            // Pre-populate default values
            const defaults: Record<string, string> = {};
            unmappedDbFields.forEach((f) => {
                if (f.key === "progressStatus") defaults[f.key] = "신규";
                else if (f.key === "source") defaults[f.key] = "메타광고";
            });
            setDefaultValues((prev) => ({
                ...defaults,
                ...prev,
            }));
            setStep(4);
        }
    };

    const handlePrev = () => {
        if (step > 1) setStep((step - 1) as Step);
    };

    const handleSubmit = async () => {
        if (!adAccountId || !partitionId || !formId) return;

        setSaving(true);
        try {
            const name = `${selectedForm?.name || formId} → ${selectedPartition?.name || partitionId}`;

            // Filter out empty default values
            const filteredDefaults: Record<string, string> = {};
            for (const [k, v] of Object.entries(defaultValues)) {
                if (v.trim()) filteredDefaults[k] = v.trim();
            }

            const result = await createIntegration({
                adAccountId,
                name,
                partitionId,
                formId,
                formName: selectedForm?.name,
                fieldMappings,
                defaultValues: Object.keys(filteredDefaults).length > 0 ? filteredDefaults : undefined,
            });

            if (result.success) {
                toast.success("연동이 생성되었습니다.");
                onCreated();
                onOpenChange(false);
            } else {
                toast.error(result.error || "연동 생성에 실패했습니다.");
            }
        } finally {
            setSaving(false);
        }
    };

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
                <DialogHeader>
                    <DialogTitle>
                        연동 추가 ({step}/4 - {STEP_NAMES[step]})
                    </DialogTitle>
                </DialogHeader>

                <div className="space-y-4">
                    {/* Step 1: 광고 소스 선택 */}
                    {step === 1 && (
                        <>
                            <div className="space-y-2">
                                <Label>플랫폼</Label>
                                <Select
                                    value={platformId ? String(platformId) : ""}
                                    onValueChange={handlePlatformChange}
                                >
                                    <SelectTrigger>
                                        <SelectValue placeholder="플랫폼 선택" />
                                    </SelectTrigger>
                                    <SelectContent>
                                        {connectedPlatforms.map((p) => {
                                            const label = p.platform === "meta" ? "Meta (Facebook/Instagram)" : p.platform === "google" ? "Google Ads" : p.platform === "naver" ? "Naver 검색광고" : p.name;
                                            return (
                                                <SelectItem key={p.id} value={String(p.id)}>
                                                    {label}
                                                </SelectItem>
                                            );
                                        })}
                                    </SelectContent>
                                </Select>
                            </div>

                            <div className="space-y-2">
                                <Label>광고 계정</Label>
                                <Select
                                    value={adAccountId ? String(adAccountId) : ""}
                                    onValueChange={handleAdAccountChange}
                                    disabled={!platformId}
                                >
                                    <SelectTrigger>
                                        <SelectValue
                                            placeholder={
                                                platformId ? "광고 계정 선택" : "플랫폼을 먼저 선택하세요"
                                            }
                                        />
                                    </SelectTrigger>
                                    <SelectContent>
                                        {accounts.map((a) => (
                                            <SelectItem key={a.id} value={String(a.id)}>
                                                {a.name}
                                            </SelectItem>
                                        ))}
                                    </SelectContent>
                                </Select>
                            </div>

                            {isMeta && (
                                <>
                                    <div className="space-y-2">
                                        <Label>페이지</Label>
                                        <Select
                                            value={pageId}
                                            onValueChange={handlePageChange}
                                            disabled={!platformId}
                                        >
                                            <SelectTrigger>
                                                <SelectValue placeholder="페이지 선택" />
                                            </SelectTrigger>
                                            <SelectContent>
                                                {pages.map((p) => (
                                                    <SelectItem key={p.id} value={p.id}>
                                                        {p.name}
                                                    </SelectItem>
                                                ))}
                                            </SelectContent>
                                        </Select>
                                    </div>

                                    <div className="space-y-2">
                                        <Label>리드 폼</Label>
                                        <Select
                                            value={formId}
                                            onValueChange={setFormId}
                                            disabled={!pageId}
                                        >
                                            <SelectTrigger>
                                                <SelectValue
                                                    placeholder={
                                                        pageId ? "리드 폼 선택" : "페이지를 먼저 선택하세요"
                                                    }
                                                />
                                            </SelectTrigger>
                                            <SelectContent>
                                                {forms.map((f) => (
                                                    <SelectItem key={f.id} value={f.id}>
                                                        {f.name} ({f.status})
                                                    </SelectItem>
                                                ))}
                                            </SelectContent>
                                        </Select>
                                    </div>
                                </>
                            )}
                        </>
                    )}

                    {/* Step 2: 대상 파티션 선택 */}
                    {step === 2 && (
                        <>
                            <div className="space-y-2">
                                <Label>워크스페이스</Label>
                                <Select
                                    value={workspaceId ? String(workspaceId) : ""}
                                    onValueChange={handleWorkspaceChange}
                                >
                                    <SelectTrigger>
                                        <SelectValue placeholder="워크스페이스 선택" />
                                    </SelectTrigger>
                                    <SelectContent>
                                        {workspaces.map((w) => (
                                            <SelectItem key={w.id} value={String(w.id)}>
                                                {w.name}
                                            </SelectItem>
                                        ))}
                                    </SelectContent>
                                </Select>
                            </div>

                            <div className="space-y-2">
                                <Label>파티션</Label>
                                <Select
                                    value={partitionId ? String(partitionId) : ""}
                                    onValueChange={(val) => setPartitionId(Number(val))}
                                    disabled={!workspaceId}
                                >
                                    <SelectTrigger>
                                        <SelectValue
                                            placeholder={
                                                workspaceId ? "파티션 선택" : "워크스페이스를 먼저 선택하세요"
                                            }
                                        />
                                    </SelectTrigger>
                                    <SelectContent>
                                        {allPartitions.map((p) => (
                                            <SelectItem key={p.id} value={String(p.id)}>
                                                {p.name}
                                            </SelectItem>
                                        ))}
                                    </SelectContent>
                                </Select>
                            </div>
                        </>
                    )}

                    {/* Step 3: 필드 매핑 */}
                    {step === 3 && (
                        <>
                            {formFieldsLoading ? (
                                <div className="flex items-center justify-center py-8">
                                    <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                                </div>
                            ) : formFields.length === 0 ? (
                                <p className="text-sm text-muted-foreground py-4">
                                    리드 폼에 필드가 없습니다.
                                </p>
                            ) : (
                                <div className="space-y-3">
                                    <p className="text-sm text-muted-foreground">
                                        리드 폼 필드를 DB 컬럼에 매핑합니다.
                                    </p>
                                    {formFields.map((ff) => (
                                        <div key={ff.key} className="flex items-center gap-2">
                                            <span className="text-sm font-mono w-[140px] shrink-0 truncate" title={ff.label}>
                                                {ff.label}
                                            </span>
                                            <span className="text-muted-foreground">&rarr;</span>
                                            <Select
                                                value={fieldMappings[ff.key] || ""}
                                                onValueChange={(val) =>
                                                    setFieldMappings((prev) => {
                                                        if (val === "__none__") {
                                                            const next = { ...prev };
                                                            delete next[ff.key];
                                                            return next;
                                                        }
                                                        return { ...prev, [ff.key]: val };
                                                    })
                                                }
                                            >
                                                <SelectTrigger className="flex-1">
                                                    <SelectValue placeholder="DB 컬럼 선택" />
                                                </SelectTrigger>
                                                <SelectContent position="popper" className="max-h-60">
                                                    <SelectItem value="__none__">-- 매핑 안 함 --</SelectItem>
                                                    {dbFields.map((df) => (
                                                        <SelectItem key={df.key} value={df.key}>
                                                            {df.label} ({df.key})
                                                        </SelectItem>
                                                    ))}
                                                </SelectContent>
                                            </Select>
                                        </div>
                                    ))}
                                </div>
                            )}
                        </>
                    )}

                    {/* Step 4: 기본값 설정 */}
                    {step === 4 && (
                        <>
                            {unmappedDbFields.length === 0 ? (
                                <p className="text-sm text-muted-foreground py-4">
                                    모든 DB 컬럼이 매핑되었습니다. 기본값 설정 없이 생성할 수 있습니다.
                                </p>
                            ) : (
                                <div className="space-y-3">
                                    <p className="text-sm text-muted-foreground">
                                        매핑되지 않은 컬럼에 고정 기본값을 설정할 수 있습니다.
                                    </p>
                                    {unmappedDbFields.map((df) => (
                                        <div key={df.key} className="flex items-center gap-2">
                                            <Label className="w-[140px] shrink-0 truncate text-sm" title={df.label}>
                                                {df.label}
                                            </Label>
                                            <Input
                                                className="flex-1"
                                                value={defaultValues[df.key] || ""}
                                                onChange={(e) =>
                                                    setDefaultValues((prev) => ({
                                                        ...prev,
                                                        [df.key]: e.target.value,
                                                    }))
                                                }
                                                placeholder={`기본값 입력`}
                                            />
                                        </div>
                                    ))}
                                </div>
                            )}
                        </>
                    )}
                </div>

                <DialogFooter className="flex justify-between sm:justify-between">
                    <div>
                        {step > 1 && (
                            <Button variant="outline" onClick={handlePrev} disabled={saving}>
                                &larr; 이전
                            </Button>
                        )}
                    </div>
                    <div className="flex gap-2">
                        <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
                            취소
                        </Button>
                        {step < 4 ? (
                            <Button
                                onClick={handleNext}
                                disabled={
                                    (step === 1 && !canProceedStep1()) ||
                                    (step === 2 && !canProceedStep2()) ||
                                    (step === 3 && !canProceedStep3())
                                }
                            >
                                다음 &rarr;
                            </Button>
                        ) : (
                            <Button onClick={handleSubmit} disabled={saving}>
                                {saving && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                                생성
                            </Button>
                        )}
                    </div>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
