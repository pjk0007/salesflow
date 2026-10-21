import { ResponsiveContainer, ComposedChart, Bar, Line, XAxis, YAxis, Tooltip, Legend, ReferenceArea } from "recharts";
import type { trendModel } from "../utils/trend";
export function TrendChart({ model, tab }: { model: ReturnType<typeof trendModel>; tab: string }) {
    return <ResponsiveContainer width="100%" height={320}>
        <ComposedChart data={model.points} margin={{ top: 25, right: 24, bottom: 5, left: 5 }}>
            <XAxis dataKey="date" fontSize={11} minTickGap={40} />
            <YAxis yAxisId="count" fontSize={11} /><YAxis yAxisId="rate" orientation="right" unit="%" fontSize={11} />
            <Tooltip /><Legend />
            {model.bands.map(band => <ReferenceArea key={band.from + band.label} yAxisId="count" x1={band.from} x2={band.to} fill="currentColor" fillOpacity={0.06} label={{ value: band.label, position: "insideTopRight", offset: 12, fontSize: 11 }} />)}
            <Bar yAxisId="count" dataKey="accepted" name="발송(접수)" fill="#94a3b8" />
            {tab === "response" ? <>
                <Line yAxisId="rate" dataKey="openRate" name="오픈율" stroke="#0d9488" dot={false} />
                <Line yAxisId="rate" dataKey="clickRate" name="클릭률" stroke="#3b82f6" dot={false} />
                <Line yAxisId="rate" dataKey="replyRate" name="회신율" stroke="#8b5cf6" dot={false} />
            </> : <>
                <Line yAxisId="rate" dataKey="bounceRate" name="반송률" stroke="#f59e0b" dot={false} />
                <Line yAxisId="rate" dataKey="unsubscribeRate" name="수신거부율" stroke="#e11d48" dot={false} />
            </>}
        </ComposedChart>
    </ResponsiveContainer>;
}
