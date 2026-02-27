import { useEffect } from "react";
import { useRouter } from "next/router";

export default function UsersRedirect() {
    const router = useRouter();

    useEffect(() => {
        router.replace("/settings?tab=users");
    }, [router]);

    return null;
}
