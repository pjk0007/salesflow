export function extractJson(content: string, jsonPattern: RegExp, truncated = false): Record<string, unknown> {
    const jsonMatch = content.match(jsonPattern);
    if (jsonMatch) {
        try { return JSON.parse(jsonMatch[0]); } catch (e) {
            console.log("[extractJson] Step 1 match found but parse failed:", e);
        }
    }
    const codeBlockMatch = content.match(/```(?:json)?\s*\n?([\s\S]*?)```/);
    if (codeBlockMatch) {
        try { return JSON.parse(codeBlockMatch[1].trim()); } catch (e) {
            console.log("[extractJson] Step 2 match found but parse failed:", e);
        }
    }
    const startIdx = content.indexOf("{");
    if (startIdx !== -1) {
        let depth = 0;
        for (let i = startIdx; i < content.length; i++) {
            if (content[i] === "{") depth++;
            else if (content[i] === "}") depth--;
            if (depth === 0) {
                const candidate = content.substring(startIdx, i + 1);
                try { return JSON.parse(candidate); } catch { /* fall through */ }
                break;
            }
        }
    }
    if (truncated || content.includes('"subject"') || content.includes('"htmlBody"')) {
        const recovered = recoverTruncatedEmailJson(content);
        if (recovered) {
            console.log("[extractJson] Step 4: recovered truncated JSON");
            return recovered;
        }
    }
    console.log("[extractJson] All steps failed. Content chars:", JSON.stringify(content.substring(0, 300)));
    throw new Error("AI 응답에서 데이터를 파싱할 수 없습니다.");
}

function recoverTruncatedEmailJson(content: string): Record<string, unknown> | null {
    const subjectMatch = content.match(/"subject"\s*:\s*"((?:[^"\\]|\\.)*)"/);
    if (!subjectMatch) return null;

    const htmlBodyStart = content.match(/"htmlBody"\s*:\s*"/);
    if (!htmlBodyStart || htmlBodyStart.index === undefined) return null;

    const valueStart = htmlBodyStart.index + htmlBodyStart[0].length;
    let htmlBody = "";
    let i = valueStart;
    while (i < content.length) {
        if (content[i] === "\\" && i + 1 < content.length) {
            const next = content[i + 1];
            if (next === "n") { htmlBody += "\n"; i += 2; continue; }
            if (next === "t") { htmlBody += "\t"; i += 2; continue; }
            if (next === '"') { htmlBody += '"'; i += 2; continue; }
            if (next === "\\") { htmlBody += "\\"; i += 2; continue; }
            htmlBody += next; i += 2; continue;
        }
        if (content[i] === '"') {
            const remaining = content.substring(i + 1).trimStart();
            if (remaining.startsWith("}") || remaining === "" || remaining.startsWith("```")) break;
            htmlBody += '"';
            i++;
            continue;
        }
        htmlBody += content[i];
        i++;
    }

    if (!htmlBody) return null;
    return { subject: subjectMatch[1], htmlBody };
}
