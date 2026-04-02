import type { Metadata } from "next";

export const metadata: Metadata = {
    title: "로그인",
    description: "Sendb 계정에 로그인하세요. 영업 데이터를 하나의 화면으로 관리합니다.",
};

export default function LoginLayout({ children }: { children: React.ReactNode }) {
    return children;
}
