import { NextRequest, NextResponse } from "next/server";
import { db, partitions, workspaces, scheduledRegistrations } from "@/lib/db";
import { eq, and } from "drizzle-orm";
import { getUserFromNextRequest } from "@/lib/auth";
import { uploadToR2 } from "@/lib/r2";
import Papa from "papaparse";
import * as XLSX from "xlsx";

const MAX_ROWS = 100_000; // 메모리/안정성 안전 상한
const INSERT_BATCH = 1000;

/** 업로드 파일(버퍼)을 행 배열(string[][])로 파싱 */
function parseFileToRows(buffer: Buffer, fileName: string): string[][] {
    const name = fileName.toLowerCase();
    if (name.endsWith(".csv")) {
        const text = buffer.toString("utf8");
        const result = Papa.parse<string[]>(text, { header: false, skipEmptyLines: true });
        return result.data;
    }
    // 엑셀
    const wb = XLSX.read(buffer, { type: "buffer" });
    const sheet = wb.Sheets[wb.SheetNames[0]];
    const rows = XLSX.utils.sheet_to_json<string[]>(sheet, {
        header: 1,
        blankrows: false,
        defval: "",
        raw: false,
    });
    return rows.map((r) => r.map((c) => String(c ?? "")));
}

export async function POST(
    req: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    const user = getUserFromNextRequest(req);
    if (!user) {
        return NextResponse.json({ success: false, error: "인증이 필요합니다." }, { status: 401 });
    }

    const { id } = await params;
    const partitionId = Number(id);
    if (!partitionId) {
        return NextResponse.json({ success: false, error: "파티션 ID가 필요합니다." }, { status: 400 });
    }

    let formData: FormData;
    try {
        formData = await req.formData();
    } catch {
        return NextResponse.json({ success: false, error: "파일 업로드 형식이 올바르지 않습니다." }, { status: 400 });
    }

    const file = formData.get("file");
    const mappingRaw = formData.get("mapping");
    if (!(file instanceof File)) {
        return NextResponse.json({ success: false, error: "파일이 필요합니다." }, { status: 400 });
    }

    let mapping: Record<string, string>;
    try {
        mapping = JSON.parse(typeof mappingRaw === "string" ? mappingRaw : "{}");
    } catch {
        return NextResponse.json({ success: false, error: "매핑 정보가 올바르지 않습니다." }, { status: 400 });
    }
    if (!mapping || Object.keys(mapping).length === 0) {
        return NextResponse.json({ success: false, error: "필드 매핑이 필요합니다." }, { status: 400 });
    }

    try {
        // 파티션 접근 검증
        const [access] = await db
            .select({ partition: partitions })
            .from(partitions)
            .innerJoin(workspaces, eq(partitions.workspaceId, workspaces.id))
            .where(and(eq(partitions.id, partitionId), eq(workspaces.orgId, user.orgId)));
        if (!access) {
            return NextResponse.json({ success: false, error: "파티션을 찾을 수 없습니다." }, { status: 404 });
        }
        const partition = access.partition;

        const buffer = Buffer.from(await file.arrayBuffer());

        // 원본 보관 (audit, best-effort)
        try {
            const key = `scheduled-imports/${user.orgId}/${partitionId}/${file.name}`;
            await uploadToR2(buffer, key, file.type || "application/octet-stream");
        } catch (err) {
            console.error("[scheduled-reg upload] R2 보관 실패(무시):", err);
        }

        const rows = parseFileToRows(buffer, file.name);
        if (rows.length < 2) {
            return NextResponse.json({ success: false, error: "데이터 행이 없습니다." }, { status: 400 });
        }
        const headers = rows[0];
        const dataRows = rows.slice(1);
        if (dataRows.length > MAX_ROWS) {
            return NextResponse.json(
                { success: false, error: `최대 ${MAX_ROWS.toLocaleString()}건까지 업로드할 수 있습니다. (${dataRows.length}건 감지)` },
                { status: 400 }
            );
        }

        // 매핑 적용: header index → fieldKey
        const colKey: Array<string | null> = headers.map((h) => mapping[h] ?? null);

        const queueValues = dataRows.map((row) => {
            const data: Record<string, unknown> = {};
            for (let c = 0; c < colKey.length; c++) {
                const key = colKey[c];
                if (key) data[key] = row[c] ?? "";
            }
            return {
                orgId: user.orgId,
                workspaceId: partition.workspaceId,
                partitionId,
                data,
                sourceFileName: file.name.slice(0, 300),
            };
        });

        // 진행률 스트리밍 응답 (NDJSON 한 줄당 이벤트): start → progress… → done|error
        const encoder = new TextEncoder();
        const values = queueValues;
        const total = values.length;
        const stream = new ReadableStream<Uint8Array>({
            async start(controller) {
                const send = (obj: unknown) => controller.enqueue(encoder.encode(JSON.stringify(obj) + "\n"));
                try {
                    send({ type: "start", total });
                    let inserted = 0;
                    for (let i = 0; i < values.length; i += INSERT_BATCH) {
                        const batch = values.slice(i, i + INSERT_BATCH);
                        await db.insert(scheduledRegistrations).values(batch);
                        inserted += batch.length;
                        send({ type: "progress", processed: inserted, total });
                    }
                    send({ type: "done", inserted });
                } catch (err) {
                    console.error("Scheduled registration upload (stream) error:", err);
                    send({ type: "error", error: "적재 중 오류가 발생했습니다." });
                } finally {
                    controller.close();
                }
            },
        });

        return new Response(stream, {
            headers: {
                "Content-Type": "application/x-ndjson; charset=utf-8",
                "Cache-Control": "no-cache, no-transform",
            },
        });
    } catch (error) {
        console.error("Scheduled registration upload error:", error);
        return NextResponse.json({ success: false, error: "서버 오류가 발생했습니다." }, { status: 500 });
    }
}
