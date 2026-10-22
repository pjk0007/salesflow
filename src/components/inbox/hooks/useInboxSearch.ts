"use client";
import { useEffect, useState } from "react";

export function useInboxSearch(value: string) {
    const [settled, setSettled] = useState(value);
    useEffect(() => {
        const timer = setTimeout(() => setSettled(value), 300);
        return () => clearTimeout(timer);
    }, [value]);
    return settled;
}
