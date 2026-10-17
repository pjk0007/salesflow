/* eslint-disable @typescript-eslint/no-require-imports -- 공식 고객 전체 XLSX의 로컬 변환 CLI */
const fs = require("node:fs");
const crypto = require("node:crypto");
const XLSX = require("xlsx");

// 원본 파일은 수정하지 않는다. 결과의 member 값은 원본 명시값만 사용한다.
function convertContacts(bytes) {
    const workbook = XLSX.read(bytes, { type: "buffer", cellDates: false });
    const sheet = workbook.Sheets["User data"];
    if (!sheet) throw new Error("공식 User data 시트가 없습니다.");
    const matrix = XLSX.utils.sheet_to_json(sheet, { header: 1, raw: true, defval: null });
    const [headers, ...records] = matrix;
    if (!headers?.includes("id") || !headers.includes("member")) throw new Error("고객 ID와 회원 구분 열을 확인해주세요.");
    if (new Set(headers).size !== headers.length || headers.some(h => typeof h !== "string" || h === "exportRow" || h.split(".").some(p => ["__proto__", "constructor", "prototype"].includes(p)) || (h.includes(".") && headers.includes(h.split(".")[0])))) throw new Error("중복되거나 지원하지 않는 열 이름입니다.");
    const ids = new Set();
    const users = records.filter(row => row.some(v => v !== null && v !== "")).map((values, index) => {
        const raw = Object.fromEntries(headers.map((h, i) => [h, values[i] ?? null]));
        if (typeof raw.id !== "string" || !raw.id || ids.has(raw.id)) throw new Error(`고객 ${index + 2}행의 원본 ID가 없거나 중복입니다.`);
        ids.add(raw.id);
        const user = { exportRow: raw };
        for (const [key, value] of Object.entries(raw)) {
            if (value === null || value === "") continue;
            const parts = key.split(".");
            if (parts.length > 2) throw new Error("지원하지 않는 중첩 열입니다.");
            if (parts.length === 2) { user[parts[0]] ??= {}; user[parts[0]][parts[1]] = value; }
            else user[key] = value;
        }
        for (const key of ["member", "hasChat", "unsubscribeEmail", "unsubscribeTexting", "hasPushToken"]) {
            const value = raw[key];
            if (value === undefined || value === null || value === "") { if (key === "member") user.member = false; continue; }
            if (![true, false, "true", "false"].includes(value)) throw new Error(`고객 ${index + 2}행의 ${key} 값이 올바르지 않습니다.`);
            user[key] = value === true || value === "true";
        }
        for (const key of ["createdAt", "updatedAt", "lastSeenAt"]) {
            if (user[key] !== undefined && (typeof user[key] !== "string" || !/^\d{4}-\d{2}-\d{2}T/.test(user[key]) || !Number.isFinite(Date.parse(user[key])))) throw new Error(`고객 ${index + 2}행의 날짜 형식을 확인해주세요.`);
        }
        // 태그 문자열은 쉼표를 포함한 실제 태그와 구별할 수 없어 원문 그대로 보존한다.
        return user;
    });
    return { users, managers: [], bots: [], userChats: [], messages: [], hasNext: false, exportMetadata: { source: "channel-contacts-full-xlsx", scope: "contacts-only", sourceSha256: crypto.createHash("sha256").update(bytes).digest("hex"), rowCount: users.length, columnCount: headers.length } };
}
if (require.main === module) {
    try {
        const [input, output] = process.argv.slice(2);
        if (!input || !output) throw new Error("사용법: node scripts/convert-channel-contacts.cjs 원본.xlsx 결과.json");
        if (fs.statSync(input).size > 128 * 1024 * 1024) throw new Error("원본 파일이 너무 큽니다.");
        const result = convertContacts(fs.readFileSync(input));
        fs.writeFileSync(output, JSON.stringify(result), { flag: "wx", mode: 0o600 });
        console.log(JSON.stringify({ ...result.exportMetadata, unverified: result.users.filter(u => u.member !== true).length, hasChat: result.users.filter(u => u.hasChat).length }));
    } catch (error) { console.error(error.message); process.exitCode = 1; }
}
module.exports = { convertContacts };
