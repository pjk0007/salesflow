"use client";
import { useState } from "react";
import useSWR from "swr";
import { Button } from "@/components/ui/button";
import { AI_MODELS, DEFAULT_MODEL_ID } from "@/lib/ai/models";
import { copyRequest } from "../api/copy";
import { controlClass, Field } from "./Fields";
type Action = <T>(url: string, body: unknown) => Promise<T | undefined>;
export function PriceSettings({
    act,
    pending,
    models,
}: {
    act: Action;
    pending: boolean;
    models?: { id: string; configured: boolean }[];
}) {
    const [model, setModel] = useState(DEFAULT_MODEL_ID),
        [currency, setCurrency] = useState("USD");
    const [price, setPrice] = useState({
        input: "",
        output: "",
        fx: "",
        date: "",
        effectiveAt: "",
        source: "",
    });
    const { data, error } = useSWR<
        {
            id: number;
            model: string;
            currency: string;
            input_per_million: string;
            output_per_million: string;
            effective_at: string;
            fx_date: string | null;
        }[]
    >("/api/ai/copy-prices", copyRequest);
    return (
        <div className="space-y-5">
            <p className="text-sm text-muted-foreground">
                공급자의 단가와 적용 시점을 등록하면 이후 생성 비용에 연결됩니다. 기존 시도의 단가는
                보존합니다. 실패 요청의 사용량을 알 수 없으면 비용도 확인 필요로 표시합니다.
            </p>
            <form
                className="grid gap-4 sm:grid-cols-2"
                onSubmit={(e) => {
                    e.preventDefault();
                    void act("/api/ai/copy-prices", {
                        provider: AI_MODELS.find((m) => m.id === model)!.provider,
                        model,
                        currency,
                        effectiveAt: new Date(`${price.effectiveAt}T00:00:00+09:00`).toISOString(),
                        inputPerMillion: Number(price.input),
                        outputPerMillion: Number(price.output),
                        fxToKrw: currency === "USD" ? Number(price.fx) : null,
                        fxDate: currency === "USD" ? price.date : null,
                        sourceUrl: price.source,
                    });
                }}
            >
                <Field label="모델">
                    {(id) => (
                        <select
                            id={id}
                            className={controlClass}
                            value={model}
                            onChange={(e) => setModel(e.target.value)}
                        >
                            {/* 단가는 연결 전에도 미리 등록할 수 있으므로 표시만 한다(UX-244). */}
                            {AI_MODELS.map((m) => (
                                <option key={m.id} value={m.id}>
                                    {m.label}
                                    {models?.find((x) => x.id === m.id)?.configured === false
                                        ? " · 연결 필요"
                                        : ""}
                                </option>
                            ))}
                        </select>
                    )}
                </Field>
                <Field label="통화">
                    {(id) => (
                        <select
                            id={id}
                            className={controlClass}
                            value={currency}
                            onChange={(e) => setCurrency(e.target.value)}
                        >
                            <option value="USD">USD</option>
                            <option value="KRW">KRW</option>
                        </select>
                    )}
                </Field>
                {(["input", "output"] as const).map((key) => (
                    <Field
                        key={key}
                        label={`100만 ${key === "input" ? "입력" : "출력"} 토큰당 단가`}
                    >
                        {(id) => (
                            <input
                                id={id}
                                className={controlClass}
                                type="number"
                                min={0}
                                step="any"
                                required
                                value={price[key]}
                                onChange={(e) => setPrice((v) => ({ ...v, [key]: e.target.value }))}
                            />
                        )}
                    </Field>
                ))}
                <Field label="단가 적용일">
                    {(id) => (
                        <input
                            id={id}
                            className={controlClass}
                            type="date"
                            required
                            value={price.effectiveAt}
                            onChange={(e) =>
                                setPrice((v) => ({ ...v, effectiveAt: e.target.value }))
                            }
                        />
                    )}
                </Field>
                <Field label="공식 단가 근거 URL">
                    {(id) => (
                        <input
                            id={id}
                            className={controlClass}
                            type="url"
                            required
                            value={price.source}
                            onChange={(e) => setPrice((v) => ({ ...v, source: e.target.value }))}
                        />
                    )}
                </Field>
                {currency === "USD" && (
                    <>
                        <Field label="1달러당 원화 환율">
                            {(id) => (
                                <input
                                    id={id}
                                    className={controlClass}
                                    type="number"
                                    min={1}
                                    step="any"
                                    required
                                    value={price.fx}
                                    onChange={(e) =>
                                        setPrice((v) => ({ ...v, fx: e.target.value }))
                                    }
                                />
                            )}
                        </Field>
                        <Field label="환율 기준일">
                            {(id) => (
                                <input
                                    id={id}
                                    className={controlClass}
                                    type="date"
                                    required
                                    value={price.date}
                                    onChange={(e) =>
                                        setPrice((v) => ({ ...v, date: e.target.value }))
                                    }
                                />
                            )}
                        </Field>
                    </>
                )}
                <div>
                    <Button disabled={pending} type="submit">
                        단가 버전 등록
                    </Button>
                </div>
            </form>
            {error ? (
                <p role="alert">단가 기록을 불러오지 못했습니다.</p>
            ) : !data ? (
                <p>단가를 불러오는 중입니다.</p>
            ) : !data.length ? (
                <p>등록된 단가가 없습니다. 비용은 확인 필요로 표시됩니다.</p>
            ) : (
                <ul className="space-y-2 text-sm">
                    {data.map((p) => (
                        <li key={p.id} className="rounded-md border p-3">
                            {p.model} · 입력 {p.input_per_million} / 출력 {p.output_per_million}{" "}
                            {p.currency} · {new Date(p.effective_at).toLocaleDateString("ko-KR")}
                            부터{p.fx_date && ` · 환율 기준 ${p.fx_date}`}
                        </li>
                    ))}
                </ul>
            )}
        </div>
    );
}
