const fetcher = (url: string, options: RequestInit) =>
    fetch(url, options).then((r) => r.json());

export function useAlimtalkSend() {
    const sendAlimtalk = async (data: {
        templateLinkId: number;
        recordIds: number[];
    }) => {
        return fetcher("/api/alimtalk/send", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(data),
        });
    };

    return { sendAlimtalk };
}
