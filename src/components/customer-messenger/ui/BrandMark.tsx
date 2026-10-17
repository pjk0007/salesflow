"use client";

import { useState } from "react";
import type { MessengerBrand } from "../types";

export function BrandMark({ brand, name, icon = false }: {
    brand?: MessengerBrand;
    name: string;
    icon?: boolean;
}) {
    const [failed, setFailed] = useState(false);
    const src = icon ? brand?.iconUrl : brand?.logoUrl;
    if (!src || failed) return <span>{icon ? name.slice(0, 1) : name}</span>;
    // 독립 상담 번들은 Next.js 이미지 서버 없이 사이트의 공식 CI를 사용합니다.
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={src} alt={icon ? `${name} 심볼` : `${name} 로고`}
        onError={() => setFailed(true)} referrerPolicy="no-referrer"
        style={{ width: icon ? 28 : 112, height: icon ? 28 : 48, objectFit: "contain" }} />;
}
