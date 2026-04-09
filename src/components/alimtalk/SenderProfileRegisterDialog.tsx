import { useState } from "react";
import { useAlimtalkSenders } from "@/hooks/useAlimtalkSenders";
import { useAlimtalkCategories } from "@/hooks/useAlimtalkCategories";
import type { NhnSenderCategory } from "@/lib/nhn-alimtalk";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Loader2, CheckCircle2 } from "lucide-react";
import { toast } from "sonner";

interface SenderProfileRegisterDialogProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
}

/** 재귀적으로 최하위 카테고리(리프)만 추출 */
/** 재귀적으로 최하위 카테고리(리프)만 추출, 코드는 각 depth의 코드를 연결 (예: 001+0001+0001 = 00100010001) */
function flattenLeafCategories(
    cats: NhnSenderCategory[],
    pathNames: string[] = [],
    pathCodes: string[] = [],
): { code: string; label: string }[] {
    const result: { code: string; label: string }[] = [];
    for (const cat of cats) {
        const names = [...pathNames, cat.name];
        const codes = [...pathCodes, cat.code];
        if (!cat.subCategories || cat.subCategories.length === 0) {
            result.push({ code: codes.join(""), label: names.join(" > ") });
        } else {
            result.push(...flattenLeafCategories(cat.subCategories, names, codes));
        }
    }
    return result;
}

export default function SenderProfileRegisterDialog({
    open,
    onOpenChange,
}: SenderProfileRegisterDialogProps) {
    const { registerSender, authenticateToken } = useAlimtalkSenders();
    const { categories, isLoading: categoriesLoading } = useAlimtalkCategories();
    const [step, setStep] = useState<1 | 2>(1);
    const [loading, setLoading] = useState(false);

    // Step 1
    const [plusFriendId, setPlusFriendId] = useState("");
    const [phoneNo, setPhoneNo] = useState("");
    const [categoryCode, setCategoryCode] = useState("");
    const [categorySearch, setCategorySearch] = useState("");

    const leafCategories = flattenLeafCategories(categories);
    const filteredCategories = categorySearch
        ? leafCategories.filter((c) => c.label.toLowerCase().includes(categorySearch.toLowerCase()))
        : leafCategories;

    // Step 2
    const [token, setToken] = useState("");

    const handleRegister = async () => {
        if (!plusFriendId || !phoneNo || !categoryCode) {
            toast.error("모든 필드를 입력해주세요.");
            return;
        }
        if (categoryCode.length !== 11) {
            toast.error("유효한 카테고리를 선택해주세요.");
            return;
        }
        setLoading(true);
        const result = await registerSender({ plusFriendId, phoneNo, categoryCode });
        setLoading(false);

        if (result.success) {
            toast.success(result.message);
            setStep(2);
        } else {
            toast.error(result.error || "등록에 실패했습니다.");
        }
    };

    const handleAuthenticate = async () => {
        if (!token) {
            toast.error("인증 토큰을 입력해주세요.");
            return;
        }
        setLoading(true);
        const result = await authenticateToken({ plusFriendId, token });
        setLoading(false);

        if (result.success) {
            toast.success(result.message);
            handleClose();
        } else {
            toast.error(result.error || "인증에 실패했습니다.");
        }
    };

    const handleClose = () => {
        setStep(1);
        setPlusFriendId("");
        setPhoneNo("");
        setCategoryCode("");
        setCategorySearch("");
        setToken("");
        onOpenChange(false);
    };

    const selectedCategoryLabel = leafCategories.find((c) => c.code === categoryCode)?.label;

    return (
        <Dialog open={open} onOpenChange={handleClose}>
            <DialogContent className="sm:max-w-md max-h-[90vh] overflow-y-auto">
                <DialogHeader>
                    <DialogTitle>
                        발신프로필 등록 {step === 2 && "- 인증"}
                    </DialogTitle>
                    <DialogDescription>
                        {step === 1
                            ? "카카오 채널 정보를 입력하여 발신프로필을 등록합니다."
                            : "카카오톡으로 전송된 인증번호를 입력해주세요."}
                    </DialogDescription>
                </DialogHeader>

                {step === 1 ? (
                    <div className="space-y-4">
                        <div className="space-y-2">
                            <Label htmlFor="plusFriendId">카카오 채널 ID</Label>
                            <Input
                                id="plusFriendId"
                                value={plusFriendId}
                                onChange={(e) => setPlusFriendId(e.target.value)}
                                placeholder="@채널ID"
                            />
                        </div>
                        <div className="space-y-2">
                            <Label htmlFor="phoneNo">관리자 핸드폰 번호</Label>
                            <Input
                                id="phoneNo"
                                value={phoneNo}
                                onChange={(e) => setPhoneNo(e.target.value)}
                                placeholder="01012345678"
                            />
                        </div>
                        <div className="space-y-2">
                            <Label>카테고리</Label>
                            <Select
                                value={categoryCode}
                                onValueChange={setCategoryCode}
                                disabled={categoriesLoading}
                            >
                                <SelectTrigger>
                                    <SelectValue placeholder={categoriesLoading ? "로딩 중..." : "카테고리 선택"}>
                                        {selectedCategoryLabel && (
                                            <span className="truncate">{selectedCategoryLabel}</span>
                                        )}
                                    </SelectValue>
                                </SelectTrigger>
                                <SelectContent>
                                    <div className="px-2 pb-2">
                                        <Input
                                            placeholder="카테고리 검색..."
                                            value={categorySearch}
                                            onChange={(e) => setCategorySearch(e.target.value)}
                                            className="h-8 text-sm"
                                            onKeyDown={(e) => e.stopPropagation()}
                                        />
                                    </div>
                                    <div className="max-h-[200px] overflow-y-auto">
                                        {filteredCategories.length === 0 ? (
                                            <div className="text-sm text-muted-foreground text-center py-4">
                                                검색 결과가 없습니다.
                                            </div>
                                        ) : (
                                            filteredCategories.map((cat) => (
                                                <SelectItem key={cat.code} value={cat.code}>
                                                    <span className="text-sm">{cat.label}</span>
                                                </SelectItem>
                                            ))
                                        )}
                                    </div>
                                </SelectContent>
                            </Select>
                        </div>
                        <Button
                            className="w-full"
                            onClick={handleRegister}
                            disabled={loading || !plusFriendId || !phoneNo || !categoryCode}
                        >
                            {loading && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                            등록 요청
                        </Button>
                    </div>
                ) : (
                    <div className="space-y-4">
                        <div className="flex items-center gap-2 p-3 bg-muted rounded-lg">
                            <CheckCircle2 className="h-4 w-4 text-green-500" />
                            <span className="text-sm">
                                {plusFriendId}에 인증번호가 전송되었습니다.
                            </span>
                        </div>
                        <div className="space-y-2">
                            <Label htmlFor="token">인증번호 (6자리)</Label>
                            <Input
                                id="token"
                                value={token}
                                onChange={(e) => setToken(e.target.value)}
                                placeholder="123456"
                                maxLength={6}
                            />
                        </div>
                        <Button
                            className="w-full"
                            onClick={handleAuthenticate}
                            disabled={loading || !token}
                        >
                            {loading && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                            인증 완료
                        </Button>
                    </div>
                )}
            </DialogContent>
        </Dialog>
    );
}
