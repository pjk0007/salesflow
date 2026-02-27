import type { NextApiRequest, NextApiResponse } from "next";

export default function handler(req: NextApiRequest, res: NextApiResponse) {
    if (req.method !== "POST") {
        return res.status(405).json({ success: false, error: "Method not allowed" });
    }

    res.setHeader(
        "Set-Cookie",
        "token=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0"
    );

    return res.status(200).json({ success: true });
}
