export async function copyRequest<T>(url: string, body?: unknown): Promise<T> {
    const response = await fetch(
        url,
        body === undefined
            ? undefined
            : {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify(body),
              },
    );
    const result = await response.json();
    if (!response.ok || result.success !== true)
        throw new Error(result.error ?? "요청을 처리하지 못했습니다.");
    return result.data as T;
}
