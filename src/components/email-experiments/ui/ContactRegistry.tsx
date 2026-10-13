"use client";
import { useState } from "react";
import useSWR from "swr";
import Papa from "papaparse";
import { Button } from "@/components/ui/button";
import { controlClass, Field } from "@/components/ai-copy/ui/Fields";
import { copyRequest } from "@/components/ai-copy/api/copy";
import type { ExperimentAction } from "../types";
export default function ContactRegistry({
    workspaces,
    act,
    pending,
}: {
    workspaces: { id: number; name: string }[];
    act: ExperimentAction;
    pending: boolean;
}) {
    const [workspaceId, setWorkspaceId] = useState(0),
        [cursor, setCursor] = useState(0),
        [error, setError] = useState<string | null>(null);
    const [contact, setContact] = useState({
        email: "",
        companyKey: "",
        companyVerified: false,
        verificationNote: "",
        tier: "unclassified",
    });
    const { data, error: loadError } = useSWR<{
        contacts: {
            id: number;
            normalized_email: string;
            company_key: string | null;
            company_verified: boolean;
            verification_note: string;
            tier: string;
        }[];
        nextCursor: number | null;
    }>(
        workspaceId
            ? `/api/email/experiments/contacts?workspaceId=${workspaceId}&cursor=${cursor}`
            : null,
        copyRequest,
    );
    return (
        <div className="space-y-4">
            <p className="text-sm text-muted-foreground">
                한 회사에서 확인된 대표 고객 한 명만 확정 비교에 넣습니다. 회사가 확인되지 않은
                고객은 탐색 집계로 구분합니다. 회사 정보와 등급을 바꿔도 이미 배정한 고객의 집계는
                소급 변경하지 않습니다.
            </p>
            <Field label="사업">
                {(id) => (
                    <select
                        id={id}
                        className={controlClass}
                        value={workspaceId || ""}
                        onChange={(e) => {
                            setWorkspaceId(Number(e.target.value));
                            setCursor(0);
                        }}
                    >
                        <option value="">선택</option>
                        {workspaces.map((w) => (
                            <option key={w.id} value={w.id}>
                                {w.name}
                            </option>
                        ))}
                    </select>
                )}
            </Field>
            <form
                className="grid gap-4 rounded-md border p-4 sm:grid-cols-2"
                onSubmit={(e) => {
                    e.preventDefault();
                    void act("/api/email/experiments/contacts", {
                        workspaceId,
                        ...contact,
                        email: contact.email.trim(),
                        companyKey: contact.companyKey.trim() || null,
                    });
                }}
            >
                <Field label="고객 이메일">
                    {(id) => (
                        <input
                            id={id}
                            required
                            type="email"
                            className={controlClass}
                            value={contact.email}
                            onChange={(e) => setContact((c) => ({ ...c, email: e.target.value }))}
                        />
                    )}
                </Field>
                <Field
                    label="회사 식별명"
                    help="같은 회사는 같은 이름이나 확인된 회사 도메인으로 적습니다."
                >
                    {(id) => (
                        <input
                            id={id}
                            className={controlClass}
                            required={contact.companyVerified}
                            value={contact.companyKey}
                            onChange={(e) =>
                                setContact((c) => ({ ...c, companyKey: e.target.value }))
                            }
                        />
                    )}
                </Field>
                <Field label="기존 고객 등급">
                    {(id) => (
                        <input
                            id={id}
                            className={controlClass}
                            required
                            value={contact.tier}
                            onChange={(e) => setContact((c) => ({ ...c, tier: e.target.value }))}
                            placeholder="예: 핵심 / 상위 / 일반 / 미분류"
                        />
                    )}
                </Field>
                <Field label="회사 확인 근거">
                    {(id) => (
                        <textarea
                            id={id}
                            className={controlClass}
                            minLength={contact.companyVerified ? 10 : undefined}
                            required={contact.companyVerified}
                            value={contact.verificationNote}
                            onChange={(e) =>
                                setContact((c) => ({ ...c, verificationNote: e.target.value }))
                            }
                        />
                    )}
                </Field>
                <label className="flex items-center gap-2 text-sm sm:col-span-2">
                    <input
                        type="checkbox"
                        checked={contact.companyVerified}
                        onChange={(e) =>
                            setContact((c) => ({ ...c, companyVerified: e.target.checked }))
                        }
                    />
                    명단·회사 자료로 확인했습니다. 개인 메일 도메인만으로 추정하지 않았습니다.
                </label>
                <div>
                    <Button type="submit" disabled={pending || !workspaceId}>
                        회사 확인 정보 저장
                    </Button>
                </div>
            </form>
            <details className="rounded-md border p-4">
                <summary className="cursor-pointer text-sm font-medium">CSV로 한 번에 등록</summary>
                <div className="mt-3 space-y-3">
                    <p className="text-sm text-muted-foreground">
                        최대 1,000명. 첫 행은 ‘이메일,회사 식별명,회사 확인,등급,확인 근거’로
                        작성합니다. 회사 확인은 ‘예’ 또는 ‘아니오’입니다. 확인하지 않은 고객을 일괄
                        확인 처리하지 않습니다.
                    </p>
                    <Field label="등록할 CSV">
                        {(id) => (
                            <input
                                id={id}
                                className={controlClass}
                                type="file"
                                accept=".csv,text/csv"
                                disabled={pending || !workspaceId}
                                onChange={async (e) => {
                                    const file = e.target.files?.[0];
                                    if (!file) return;
                                    setError(null);
                                    try {
                                        const parsed = Papa.parse<Record<string, string>>(
                                            await file.text(),
                                            { header: true, skipEmptyLines: true },
                                        );
                                        if (parsed.errors.length)
                                            throw new Error("CSV 열과 따옴표를 확인해 주세요.");
                                        if (!parsed.data.length || parsed.data.length > 1000)
                                            throw new Error("1~1,000명의 명단을 선택해 주세요.");
                                        const rows = parsed.data.map((r) => {
                                            const verified = r["회사 확인"]?.trim();
                                            if (!["예", "아니오"].includes(verified))
                                                throw new Error(
                                                    "회사 확인 열에는 예 또는 아니오를 입력해 주세요.",
                                                );
                                            return {
                                                workspaceId,
                                                email: r["이메일"]?.trim(),
                                                companyKey: r["회사 식별명"]?.trim() || null,
                                                companyVerified: verified === "예",
                                                tier: r["등급"]?.trim() || "unclassified",
                                                verificationNote: r["확인 근거"]?.trim() || "",
                                            };
                                        });
                                        await act("/api/email/experiments/contacts", rows);
                                    } catch (cause) {
                                        setError(
                                            cause instanceof Error
                                                ? cause.message
                                                : "CSV를 읽지 못했습니다.",
                                        );
                                    }
                                }}
                            />
                        )}
                    </Field>
                    {error && (
                        <p role="alert" className="text-sm">
                            {error}
                        </p>
                    )}
                </div>
            </details>
            {loadError ? (
                <p role="alert">회사 확인 정보를 불러오지 못했습니다.</p>
            ) : workspaceId > 0 && !data ? (
                <p>회사 확인 정보를 불러오는 중입니다.</p>
            ) : (
                data && (
                    <div className="overflow-x-auto">
                        <table className="w-full text-left text-sm">
                            <thead>
                                <tr>
                                    {["고객", "회사", "확인", "등급", "변경"].map((s) => (
                                        <th key={s} className="border-b p-2">
                                            {s}
                                        </th>
                                    ))}
                                </tr>
                            </thead>
                            <tbody>
                                {data.contacts.map((c) => (
                                    <tr key={c.id}>
                                        <td className="border-b p-2">{c.normalized_email}</td>
                                        <td className="border-b p-2">
                                            {c.company_key ?? "미확인"}
                                        </td>
                                        <td className="border-b p-2">
                                            {c.company_verified ? "확인" : "탐색"}
                                        </td>
                                        <td className="border-b p-2">{c.tier}</td>
                                        <td className="border-b p-2">
                                            <Button
                                                size="sm"
                                                variant="outline"
                                                onClick={() =>
                                                    setContact({
                                                        email: c.normalized_email,
                                                        companyKey: c.company_key ?? "",
                                                        companyVerified: c.company_verified,
                                                        verificationNote: c.verification_note,
                                                        tier: c.tier,
                                                    })
                                                }
                                            >
                                                수정
                                            </Button>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                        {!data.contacts.length && (
                            <p className="py-3 text-muted-foreground">
                                등록된 회사 확인 정보가 없습니다.
                            </p>
                        )}
                    </div>
                )
            )}
            <div className="flex gap-2">
                {cursor > 0 && (
                    <Button variant="outline" onClick={() => setCursor(0)}>
                        처음
                    </Button>
                )}
                {data?.nextCursor && (
                    <Button variant="outline" onClick={() => setCursor(data.nextCursor!)}>
                        다음 고객
                    </Button>
                )}
            </div>
        </div>
    );
}
