import { useState } from "react";

interface CompanyResearchResult {
    companyName: string;
    industry: string;
    description: string;
    services: string;
    employees: string;
    website: string;
    sources: Array<{ url: string; title: string }>;
}

export function useCompanyResearch() {
    const [isResearching, setIsResearching] = useState(false);

    const researchCompany = async (input: { companyName: string }): Promise<{
        success: boolean;
        data?: CompanyResearchResult;
        error?: string;
    }> => {
        setIsResearching(true);
        try {
            const res = await fetch("/api/ai/research-company", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(input),
            });
            return await res.json();
        } catch {
            return { success: false, error: "서버에 연결할 수 없습니다." };
        } finally {
            setIsResearching(false);
        }
    };

    return { researchCompany, isResearching };
}
