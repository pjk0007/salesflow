import { useState, useMemo } from "react";
import { useCompanyResearch } from "@/hooks/useCompanyResearch";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Loader2, Sparkles, Search, ExternalLink, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import type { FieldDefinition } from "@/types";

interface CompanyResearch {
    companyName: string;
    industry: string;
    description: string;
    services: string;
    employees: string;
    website: string;
    sources: Array<{ url: string; title: string }>;
    researchedAt: string;
}

interface CompanyResearchSectionProps {
    recordId: number;
    recordData: Record<string, unknown>;
    fields: FieldDefinition[];
    onUpdated: () => void;
}

const COMPANY_FIELD_KEYS = ["company", "회사", "회사명", "기업", "기업명", "업체", "업체명"];

export default function CompanyResearchSection({
    recordId,
    recordData,
    fields,
    onUpdated,
}: CompanyResearchSectionProps) {
    const { researchCompany, isResearching } = useCompanyResearch();

    // 레코드에서 회사명 자동 추출
    const autoCompanyName = useMemo(() => {
        for (const field of fields) {
            if (COMPANY_FIELD_KEYS.includes(field.key.toLowerCase())) {
                const val = recordData[field.key];
                if (val && typeof val === "string") return val;
            }
        }
        // label로도 시도
        for (const field of fields) {
            if (COMPANY_FIELD_KEYS.includes(field.label.toLowerCase())) {
                const val = recordData[field.key];
                if (val && typeof val === "string") return val;
            }
        }
        return "";
    }, [recordData, fields]);

    const existing = recordData._companyResearch as CompanyResearch | undefined;
    const [companyName, setCompanyName] = useState(autoCompanyName);
    const [isSaving, setIsSaving] = useState(false);
    const [research, setResearch] = useState<CompanyResearch | null>(
        existing && typeof existing === "object" ? existing : null
    );

    const handleResearch = async () => {
        if (!companyName.trim()) {
            toast.error("회사명을 입력해주세요.");
            return;
        }

        const result = await researchCompany({ companyName: companyName.trim() });

        if (result.success && result.data) {
            const newResearch: CompanyResearch = {
                ...result.data,
                researchedAt: new Date().toISOString(),
            };
            setResearch(newResearch);

            // 바로 저장
            setIsSaving(true);
            try {
                const res = await fetch(`/api/records/${recordId}`, {
                    method: "PATCH",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ data: { _companyResearch: newResearch } }),
                });
                const saveResult = await res.json();
                if (saveResult.success) {
                    toast.success("회사 정보가 저장되었습니다.");
                    onUpdated();
                } else {
                    toast.error(saveResult.error || "저장에 실패했습니다.");
                }
            } catch {
                toast.error("서버에 연결할 수 없습니다.");
            } finally {
                setIsSaving(false);
            }
        } else {
            toast.error(result.error || "회사 조사에 실패했습니다.");
        }
    };

    return (
        <div className="space-y-3">
            <div className="flex items-center justify-between">
                <h3 className="text-sm font-medium text-muted-foreground">회사 정보</h3>
                {research && (
                    <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setResearch(null)}
                        className="h-7 text-xs text-muted-foreground"
                    >
                        <RefreshCw className="h-3 w-3 mr-1" />
                        재조사
                    </Button>
                )}
            </div>

            {!research ? (
                <div className="space-y-2 p-3 bg-muted/50 rounded-lg border border-dashed">
                    <div className="flex gap-2">
                        <Input
                            value={companyName}
                            onChange={(e) => setCompanyName(e.target.value)}
                            placeholder="회사명 또는 URL"
                            className="flex-1"
                            onKeyDown={(e) => {
                                if (e.key === "Enter" && !isResearching) handleResearch();
                            }}
                        />
                        <Button
                            onClick={handleResearch}
                            disabled={isResearching || isSaving || !companyName.trim()}
                            size="sm"
                        >
                            {isResearching ? (
                                <Loader2 className="h-4 w-4 animate-spin" />
                            ) : (
                                <>
                                    <Sparkles className="h-4 w-4 mr-1" />
                                    <Search className="h-4 w-4" />
                                </>
                            )}
                        </Button>
                    </div>
                    <p className="text-xs text-muted-foreground">
                        AI가 웹을 검색하여 회사 정보를 자동으로 조사합니다
                    </p>
                </div>
            ) : (
                <div className="space-y-0 border rounded-lg">
                    <InfoRow label="회사명" value={research.companyName} />
                    <InfoRow label="업종" value={research.industry} />
                    <InfoRow label="소개" value={research.description} multiline />
                    <InfoRow label="주요 서비스" value={research.services} />
                    <InfoRow label="규모" value={research.employees} />
                    <InfoRow
                        label="웹사이트"
                        value={research.website}
                        isLink
                    />
                    {research.sources.length > 0 && (
                        <div className="px-3 py-2 border-t">
                            <span className="text-xs text-muted-foreground font-medium">출처: </span>
                            {research.sources.map((s, i) => (
                                <span key={i}>
                                    {i > 0 && ", "}
                                    <a
                                        href={s.url}
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        className="text-xs text-blue-600 hover:underline inline-flex items-center gap-0.5"
                                    >
                                        {s.title}
                                        <ExternalLink className="h-2.5 w-2.5" />
                                    </a>
                                </span>
                            ))}
                        </div>
                    )}
                    {research.researchedAt && (
                        <div className="px-3 py-1.5 border-t text-xs text-muted-foreground">
                            조사일: {new Date(research.researchedAt).toLocaleString("ko-KR")}
                        </div>
                    )}
                </div>
            )}
        </div>
    );
}

function InfoRow({
    label,
    value,
    multiline,
    isLink,
}: {
    label: string;
    value: string;
    multiline?: boolean;
    isLink?: boolean;
}) {
    if (!value || value === "정보 없음") return null;

    return (
        <div className="grid grid-cols-4 gap-2 px-3 py-2 border-b last:border-0">
            <span className="text-xs text-muted-foreground">{label}</span>
            <span className={`col-span-3 text-sm ${multiline ? "whitespace-pre-wrap" : ""}`}>
                {isLink ? (
                    <a
                        href={value.startsWith("http") ? value : `https://${value}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-blue-600 hover:underline inline-flex items-center gap-1"
                    >
                        {value}
                        <ExternalLink className="h-3 w-3" />
                    </a>
                ) : (
                    value
                )}
            </span>
        </div>
    );
}
