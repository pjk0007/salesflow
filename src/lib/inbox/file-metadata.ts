export function fileName(raw: string) {
    return (
        Array.from(
            raw
                .toWellFormed()
                .replace(/[\u0000-\u001f\u007f/\\]/g, "_")
                .trim(),
        )
            .slice(0, 160)
            .join("") || "파일"
    );
}
export function safeContentType(bytes: Buffer) {
    if (
        bytes
            .subarray(0, 8)
            .equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
    )
        return "image/png";
    if (
        bytes.length > 3 &&
        bytes[0] === 255 &&
        bytes[1] === 216 &&
        bytes[2] === 255
    )
        return "image/jpeg";
    if (["GIF87a", "GIF89a"].includes(bytes.subarray(0, 6).toString()))
        return "image/gif";
    if (
        bytes.subarray(0, 4).toString() === "RIFF" &&
        bytes.subarray(8, 12).toString() === "WEBP"
    )
        return "image/webp";
    if (bytes.subarray(0, 5).toString() === "%PDF-") return "application/pdf";
    return "application/octet-stream";
}
