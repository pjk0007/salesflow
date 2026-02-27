import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";

const INDUSTRIES = [
    "IT/소프트웨어",
    "제조업",
    "유통/무역",
    "부동산",
    "금융",
    "교육",
    "기타",
];

const COMPANY_SIZES = [
    "1~5명",
    "6~20명",
    "21~50명",
    "51~200명",
    "200명+",
];

interface WelcomeStepProps {
    orgName: string;
    industry: string;
    companySize: string;
    onOrgNameChange: (value: string) => void;
    onIndustryChange: (value: string) => void;
    onCompanySizeChange: (value: string) => void;
}

export default function WelcomeStep({
    orgName,
    industry,
    companySize,
    onOrgNameChange,
    onIndustryChange,
    onCompanySizeChange,
}: WelcomeStepProps) {
    return (
        <div className="space-y-6 text-center">
            <div>
                <h2 className="text-2xl font-bold">환영합니다!</h2>
                <p className="mt-2 text-muted-foreground">
                    서비스를 시작하기 전에 몇 가지를 설정해볼까요?
                </p>
            </div>

            <div className="space-y-4 text-left">
                <div className="space-y-2">
                    <Label htmlFor="orgName">조직 이름</Label>
                    <Input
                        id="orgName"
                        value={orgName}
                        onChange={(e) => onOrgNameChange(e.target.value)}
                        placeholder="조직 이름을 입력하세요"
                    />
                </div>

                <div className="space-y-2">
                    <Label>업종 (선택사항)</Label>
                    <Select value={industry} onValueChange={onIndustryChange}>
                        <SelectTrigger>
                            <SelectValue placeholder="업종을 선택하세요" />
                        </SelectTrigger>
                        <SelectContent>
                            {INDUSTRIES.map((item) => (
                                <SelectItem key={item} value={item}>
                                    {item}
                                </SelectItem>
                            ))}
                        </SelectContent>
                    </Select>
                </div>

                <div className="space-y-2">
                    <Label>규모 (선택사항)</Label>
                    <Select value={companySize} onValueChange={onCompanySizeChange}>
                        <SelectTrigger>
                            <SelectValue placeholder="규모를 선택하세요" />
                        </SelectTrigger>
                        <SelectContent>
                            {COMPANY_SIZES.map((item) => (
                                <SelectItem key={item} value={item}>
                                    {item}
                                </SelectItem>
                            ))}
                        </SelectContent>
                    </Select>
                </div>
            </div>
        </div>
    );
}
