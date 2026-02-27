"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

export default function UsersRedirect() {
    const router = useRouter();

    useEffect(() => {
        router.replace("/settings?tab=users");
    }, [router]);

    return null;
}
