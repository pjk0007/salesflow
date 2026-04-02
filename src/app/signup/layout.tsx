import type { Metadata } from "next";

export const metadata: Metadata = {
    title: "회원가입",
    description: "Sendb 계정을 무료로 생성하세요. 신용카드 없이 바로 시작할 수 있습니다.",
};

export default function SignupLayout({ children }: { children: React.ReactNode }) {
    return children;
}
