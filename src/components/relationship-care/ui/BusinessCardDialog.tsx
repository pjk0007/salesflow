"use client";
import { useRef, useState } from "react";
import { toast } from "sonner";
import { Camera } from "lucide-react";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog";
import { TIERS, TIER_LABEL, DEFAULT_CADENCE } from "@/lib/relationship-care/rules";
import { registerCard, scanCard } from "../api";
import type { RegisterResult, Tier } from "../types";
import { seoulToday } from "../utils/links";
type Fields = {
    name: string;
    companyName: string;
    title: string;
    email: string;
    phone: string;
    website: string;
    memoryNote: string;
};
const empty: Fields = {
    name: "",
    companyName: "",
    title: "",
    email: "",
    phone: "",
    website: "",
    memoryNote: "",
};
const LABELS: Record<Exclude<keyof Fields, "memoryNote">, string> = {
    name: "이름",
    companyName: "회사",
    title: "직함",
    email: "메일",
    phone: "전화",
    website: "웹사이트",
};
/** 명함 등록(기획서 4절 ②): 촬영 → 글자 인식 → 확인 → 3칸(만난 곳·메모·등급) → 저장 */
export function BusinessCardDialog({
    open,
    workspaceId,
    onOpenChange,
    onSaved,
}: {
    open: boolean;
    workspaceId: number;
    onOpenChange: (open: boolean) => void;
    onSaved: () => Promise<unknown> | void;
}) {
    const [fields, setFields] = useState<Fields>(empty);
    const [metPlace, setMetPlace] = useState("");
    const [metOn, setMetOn] = useState(seoulToday());
    const [tier, setTier] = useState<Tier>("c");
    const [keepGoing, setKeepGoing] = useState(true);
    const [busy, setBusy] = useState<"scan" | "save" | null>(null);
    const [duplicates, setDuplicates] = useState<Extract<RegisterResult, { status: "duplicate" }>["duplicates"]>([]);
    const [savedCount, setSavedCount] = useState(0);
    const fileRef = useRef<HTMLInputElement>(null);
    const set = (key: keyof Fields, value: string) => setFields((f) => ({ ...f, [key]: value }));
    function resetCard() {
        setFields(empty);
        setDuplicates([]);
        if (fileRef.current) fileRef.current.value = "";
    }
    async function onPhoto(file: File | undefined) {
        if (!file) return;
        setBusy("scan");
        try {
            const { fields: read } = await scanCard(workspaceId, file);
            setFields((f) => ({
                ...f,
                name: read.name ?? "",
                companyName: read.companyName ?? "",
                title: read.title ?? "",
                email: read.email ?? "",
                phone: read.phone ?? "",
                website: read.website ?? "",
            }));
            toast.success("명함을 읽었습니다. 틀린 글자가 없는지 확인해주세요.");
        } catch (e) {
            toast.error((e as Error).message);
        } finally {
            setBusy(null);
        }
    }
    async function save(extra: { attachToContactId?: string; allowDuplicate?: boolean } = {}) {
        if (!fields.name.trim()) {
            toast.error("이름을 입력해주세요.");
            return;
        }
        setBusy("save");
        try {
            const result = await registerCard({
                workspaceId,
                name: fields.name.trim(),
                email: fields.email.trim() || null,
                phone: fields.phone.trim() || null,
                companyName: fields.companyName.trim() || null,
                title: fields.title.trim() || null,
                website: fields.website.trim() || null,
                metPlace: metPlace.trim() || null,
                metOn: metOn || null,
                memoryNote: fields.memoryNote,
                tier,
                ...extra,
            });
            if (result.status === "duplicate") {
                setDuplicates(result.duplicates);
                return;
            }
            toast.success(`${fields.name}님을 등록했습니다. 첫 인사 카드를 만들었습니다(10장이 차 있으면 앞 카드를 처리한 뒤 올라옵니다).`);
            setSavedCount((n) => n + 1);
            await onSaved();
            resetCard();
            if (!keepGoing) onOpenChange(false);
        } catch (e) {
            toast.error((e as Error).message);
        } finally {
            setBusy(null);
        }
    }
    return (
        <Dialog
            open={open}
            onOpenChange={(next) => {
                if (!next) {
                    resetCard();
                    setSavedCount(0);
                }
                onOpenChange(next);
            }}
        >
            <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-lg">
                <DialogHeader>
                    <DialogTitle>명함 등록</DialogTitle>
                    <DialogDescription>
                        사진을 찍으면 글자를 읽어 채웁니다. 사진은 저장하지 않습니다.
                        {savedCount > 0 && ` 이번에 ${savedCount}장 등록했습니다.`}
                    </DialogDescription>
                </DialogHeader>
                <label className="flex cursor-pointer items-center justify-center gap-2 rounded-xl border border-dashed p-4 text-sm text-violet-700">
                    <Camera size={18} />
                    {busy === "scan" ? "명함을 읽는 중…" : "명함 촬영 또는 사진 선택"}
                    <input
                        ref={fileRef}
                        type="file"
                        accept="image/jpeg,image/png,image/webp"
                        capture="environment"
                        className="sr-only"
                        disabled={!!busy}
                        onChange={(e) => void onPhoto(e.target.files?.[0])}
                    />
                </label>
                <div className="grid grid-cols-2 gap-3 text-sm">
                    {(Object.keys(LABELS) as (keyof typeof LABELS)[]).map((key) => (
                        <label key={key} className={key === "name" ? "col-span-2" : ""}>
                            <span className="text-xs text-muted-foreground">
                                {LABELS[key]}
                                {key === "name" && " (필수)"}
                            </span>
                            <input
                                className="mt-1 w-full rounded-lg border bg-background px-3 py-2"
                                value={fields[key]}
                                type={key === "email" ? "email" : key === "phone" ? "tel" : "text"}
                                maxLength={key === "website" ? 300 : key === "companyName" ? 200 : 100}
                                onChange={(e) => set(key, e.target.value)}
                            />
                        </label>
                    ))}
                </div>
                <fieldset className="space-y-3 rounded-xl bg-muted/40 p-3 text-sm">
                    <legend className="sr-only">만난 곳·메모·등급</legend>
                    <div className="grid grid-cols-2 gap-3">
                        <label>
                            <span className="text-xs text-muted-foreground">만난 곳(행사명)</span>
                            <input
                                className="mt-1 w-full rounded-lg border bg-background px-3 py-2"
                                value={metPlace}
                                maxLength={200}
                                placeholder="예: 스마트공장 엑스포"
                                onChange={(e) => setMetPlace(e.target.value)}
                            />
                        </label>
                        <label>
                            <span className="text-xs text-muted-foreground">만난 날</span>
                            <input
                                type="date"
                                className="mt-1 w-full rounded-lg border bg-background px-3 py-2"
                                value={metOn}
                                onChange={(e) => setMetOn(e.target.value)}
                            />
                        </label>
                    </div>
                    <label className="block">
                        <span className="text-xs text-muted-foreground">대화 메모 한 줄(다음 인사 초안에 씁니다)</span>
                        <input
                            className="mt-1 w-full rounded-lg border bg-background px-3 py-2"
                            value={fields.memoryNote}
                            maxLength={2000}
                            placeholder="예: 다음 달 일본 출장 간다고 함"
                            onChange={(e) => set("memoryNote", e.target.value)}
                        />
                    </label>
                    <div>
                        <span className="text-xs text-muted-foreground">점검 등급</span>
                        <div className="mt-1 grid grid-cols-2 gap-2 sm:grid-cols-4" role="radiogroup" aria-label="점검 등급">
                            {TIERS.map((t) => (
                                <button
                                    key={t}
                                    type="button"
                                    role="radio"
                                    aria-checked={tier === t}
                                    className={`rounded-lg px-2 py-2 text-xs ${tier === t ? "bg-violet-600 text-white" : "border bg-background"}`}
                                    onClick={() => setTier(t)}
                                >
                                    {TIER_LABEL[t]}
                                    <span className="block opacity-75">{DEFAULT_CADENCE[t]}일마다</span>
                                </button>
                            ))}
                        </div>
                    </div>
                </fieldset>
                {duplicates.length > 0 && (
                    <div role="alert" className="space-y-2 rounded-xl bg-amber-50 p-3 text-sm text-amber-900">
                        <p>메일이나 전화번호가 같은 고객이 이미 있습니다.</p>
                        {duplicates.map((d) => (
                            <div key={d.id} className="flex flex-wrap items-center justify-between gap-2">
                                <span>
                                    {d.name} · {d.email ?? d.phone ?? ""}
                                </span>
                                <button
                                    className="rounded-lg bg-amber-600 px-3 py-1 text-xs text-white disabled:opacity-50"
                                    disabled={!!busy}
                                    onClick={() => void save({ attachToContactId: d.id })}
                                >
                                    이 고객에 관계 관리 붙이기
                                </button>
                            </div>
                        ))}
                        <button
                            className="text-xs underline disabled:opacity-50"
                            disabled={!!busy}
                            onClick={() => void save({ allowDuplicate: true })}
                        >
                            다른 사람입니다 — 새 고객으로 저장
                        </button>
                    </div>
                )}
                <div className="flex flex-wrap items-center justify-between gap-3 text-sm">
                    <label className="flex items-center gap-2 text-xs">
                        <input type="checkbox" checked={keepGoing} onChange={(e) => setKeepGoing(e.target.checked)} />
                        저장 후 다음 명함 이어서 등록(만난 곳·날·등급 유지)
                    </label>
                    <button
                        className="rounded-lg bg-violet-600 px-4 py-2 text-white disabled:opacity-50"
                        disabled={!!busy || !fields.name.trim()}
                        onClick={() => void save()}
                    >
                        {busy === "save" ? "저장 중…" : "저장"}
                    </button>
                </div>
            </DialogContent>
        </Dialog>
    );
}
