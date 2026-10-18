/* eslint-disable @next/next/no-img-element -- Local PNG marks must preserve the selected pixels. */
"use client";

import { useEffect, useRef, useState } from "react";
import { Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useNameMarks } from "../hooks/useNameMarks";
import { COMPANY_SEAL_STYLES, PERSONAL_SEAL_STYLES, SEAL_FONTS, SIGNATURE_STYLES, type NameMarkKind, type SealCategory, type SealFont } from "../utils/name-marks";
import { fitPng } from "../utils/raster";

export function NameMarkPicker({ kind, signerName, aspect, busy, onUse }: { kind: NameMarkKind; signerName: string; aspect: number; busy: boolean; onUse: (image: string) => void }) {
    const [name, setName] = useState(signerName);
    const [category, setCategory] = useState<SealCategory>("personal");
    const [companyName, setCompanyName] = useState("");
    const [centerText, setCenterText] = useState("대표이사");
    const [font, setFont] = useState<SealFont>("engraved");
    const [selected, setSelected] = useState("");
    const [saving, setSaving] = useState(false);
    const [saveError, setSaveError] = useState("");
    const mounted = useRef(true);
    useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
    const company = kind === "seal" && category === "company";
    const markName = company ? companyName : name;
    const { images, error, loading, canRetry, retry } = useNameMarks(markName, kind, { category, font, centerText });
    const styles = kind === "seal" ? company ? COMPANY_SEAL_STYLES : PERSONAL_SEAL_STYLES : SIGNATURE_STYLES;
    const label = kind === "seal" ? "도장" : "서명";
    const chosen = images[selected];
    const locked = busy || saving;
    const reset = () => { setSelected(""); setSaveError(""); };
    return <div className="space-y-4">
        {kind === "seal" && <div className="grid grid-cols-2 gap-2" role="group" aria-label="도장 종류"><Button type="button" variant={category === "personal" ? "secondary" : "outline"} aria-pressed={category === "personal"} disabled={locked} onClick={() => { setCategory("personal"); reset(); }}>개인 도장</Button><Button type="button" variant={category === "company" ? "secondary" : "outline"} aria-pressed={category === "company"} disabled={locked} onClick={() => { setCategory("company"); reset(); }}>회사 직인</Button></div>}
        <label className="block space-y-2 text-sm"><span>{company ? "직인에 넣을 회사명" : `${label}에 넣을 본인 이름`}</span><Input autoFocus value={markName} maxLength={company ? 40 : kind === "seal" ? 16 : 30} disabled={locked} placeholder={company ? "예: 매치스플랜" : kind === "seal" ? "예: 김이삭" : "예: 김이삭 / Isaac Kim"} onChange={event => { if (company) setCompanyName(event.target.value); else setName(event.target.value); reset(); }} /></label>
        {kind === "seal" && <div className={`grid gap-3 ${company ? "sm:grid-cols-2" : ""}`}>
            {company && <label className="block space-y-2 text-sm"><span>가운데 글자·직함</span><Input value={centerText} maxLength={12} disabled={locked} placeholder="대표이사 / 사용인" onChange={event => { setCenterText(event.target.value); reset(); }} /></label>}
            <label className="block space-y-2 text-sm"><span>도장 서체</span><select aria-label="도장 서체" className="h-9 w-full rounded-md border bg-background px-3 text-sm" value={font} disabled={locked} onChange={event => { setFont(event.target.value as SealFont); reset(); }}>{SEAL_FONTS.map(item => <option key={item.id} value={item.id}>{item.label}</option>)}</select></label>
        </div>}
        <p className="text-xs text-muted-foreground">{kind === "seal" ? company ? "회사명은 2~24자, 가운데 글자는 1~8자까지 가능합니다. 원하는 직인 모양을 선택해 주세요." : "이름은 공백을 빼고 2~8자까지 가능합니다. 서체와 인장 모양을 함께 비교해 보세요." : "입력한 이름으로 만든 손글씨 중 마음에 드는 서명을 선택해 주세요."}</p>
        {loading && <div role="status" className="flex h-36 items-center justify-center rounded-lg bg-muted/40 text-sm text-muted-foreground">{label} 미리보기를 만드는 중…</div>}
        {error && <div className="space-y-2"><p role="alert" className="text-sm text-red-700">{error}</p>{canRetry && <Button type="button" size="sm" variant="outline" disabled={locked} onClick={retry}>다시 만들기</Button>}</div>}
        {Object.keys(images).length > 0 && <div className="grid grid-cols-2 gap-3" role="group" aria-label={`${label} 스타일 선택`}>
            {styles.map(style => <button key={style.id} type="button" disabled={locked} aria-label={`${style.label} 선택`} aria-pressed={selected === style.id} onClick={() => { setSelected(style.id); setSaveError(""); }} className={`relative min-w-0 rounded-xl border-2 bg-white p-3 text-left transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary disabled:opacity-60 ${selected === style.id ? "border-primary ring-1 ring-primary" : "border-border hover:border-primary/50"}`}>
                <div className={`flex items-center justify-center ${kind === "seal" ? "h-24 sm:h-28" : "h-20 sm:h-24"}`}><img src={images[style.id]} alt={`${markName} · ${style.label}${kind === "seal" ? ` · ${SEAL_FONTS.find(item => item.id === font)?.label}` : ""}`} className="max-h-full max-w-full object-contain" /></div>
                <div className="mt-2 flex items-center justify-between gap-1 text-xs sm:text-sm"><span>{style.label}</span><span className={`flex size-5 shrink-0 items-center justify-center rounded-full ${selected === style.id ? "bg-primary text-primary-foreground" : "border"}`}>{selected === style.id && <Check className="size-3.5" aria-hidden />}</span></div>
            </button>)}
        </div>}
        {chosen && <p role="status" className="text-sm text-muted-foreground">{styles.find(style => style.id === selected)?.label} 선택됨</p>}
        {saveError && <p role="alert" className="text-sm text-red-700">{saveError}</p>}
        <Button type="button" className="w-full" disabled={locked || !chosen} onClick={async () => {
            setSaving(true); setSaveError("");
            try { const image = await fitPng(chosen, aspect); if (mounted.current) onUse(image); } catch (cause) { if (mounted.current) setSaveError(cause instanceof Error ? cause.message : "이미지를 넣지 못했습니다."); }
            finally { if (mounted.current) setSaving(false); }
        }}>{saving ? "준비 중…" : `선택한 ${label} 문서에 넣기`}</Button>
    </div>;
}
