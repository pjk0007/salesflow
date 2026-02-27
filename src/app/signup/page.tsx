"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
    Card,
    CardContent,
    CardDescription,
    CardHeader,
    CardTitle,
} from "@/components/ui/card";
import { useSession } from "@/contexts/SessionContext";

export default function SignupPage() {
    const router = useRouter();
    const { refreshSession } = useSession();
    const [name, setName] = useState("");
    const [email, setEmail] = useState("");
    const [password, setPassword] = useState("");
    const [error, setError] = useState("");
    const [isLoading, setIsLoading] = useState(false);

    const handleSubmit = async (e: FormEvent) => {
        e.preventDefault();
        setError("");
        setIsLoading(true);

        try {
            const res = await fetch("/api/auth/signup", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ email, password, name }),
            });
            const data = await res.json();

            if (data.success) {
                await refreshSession();
                router.push("/onboarding");
            } else {
                setError(data.error || "회원가입에 실패했습니다.");
            }
        } catch {
            setError("서버에 연결할 수 없습니다.");
        } finally {
            setIsLoading(false);
        }
    };

    return (
        <div className="flex min-h-screen">
            {/* 좌측 브랜드 패널 */}
            <div className="hidden lg:flex lg:w-1/2 flex-col justify-between bg-primary p-12 text-primary-foreground">
                <Link href="/" className="text-xl font-bold text-primary-foreground hover:opacity-80">SalesFlow</Link>
                <div className="space-y-4">
                    <h2 className="text-3xl font-bold leading-tight">
                        스마트한 영업 관리를
                        <br />
                        시작하세요
                    </h2>
                    <p className="text-primary-foreground/80">
                        무료로 가입하고 바로 시작하세요.
                    </p>
                </div>
                <p className="text-sm text-primary-foreground/60">
                    &copy; 2026 SalesFlow. All rights reserved.
                </p>
            </div>

            {/* 우측 폼 영역 */}
            <div className="flex flex-1 items-center justify-center p-4 sm:p-8">
                <div className="w-full max-w-md">
                    <Card>
                        <CardHeader className="text-center">
                            <CardTitle className="text-2xl font-bold">
                                회원가입
                            </CardTitle>
                            <CardDescription>
                                SalesFlow 계정을 생성합니다
                            </CardDescription>
                        </CardHeader>
                        <CardContent>
                            <form
                                onSubmit={handleSubmit}
                                className="space-y-4"
                            >
                                <div className="space-y-2">
                                    <Label htmlFor="name">이름</Label>
                                    <Input
                                        id="name"
                                        type="text"
                                        placeholder="이름을 입력하세요"
                                        value={name}
                                        onChange={(e) => setName(e.target.value)}
                                        required
                                        autoFocus
                                    />
                                </div>
                                <div className="space-y-2">
                                    <Label htmlFor="email">이메일</Label>
                                    <Input
                                        id="email"
                                        type="email"
                                        placeholder="이메일을 입력하세요"
                                        value={email}
                                        onChange={(e) => setEmail(e.target.value)}
                                        required
                                    />
                                </div>
                                <div className="space-y-2">
                                    <Label htmlFor="password">비밀번호</Label>
                                    <Input
                                        id="password"
                                        type="password"
                                        placeholder="6자 이상"
                                        value={password}
                                        onChange={(e) => setPassword(e.target.value)}
                                        required
                                    />
                                </div>
                                {error && (
                                    <div className="rounded-md bg-destructive/10 p-3 text-sm text-destructive text-center">
                                        {error}
                                    </div>
                                )}
                                <Button
                                    type="submit"
                                    className="w-full"
                                    disabled={isLoading}
                                >
                                    {isLoading ? "가입 중..." : "회원가입"}
                                </Button>
                                <p className="text-center text-sm text-muted-foreground">
                                    이미 계정이 있으신가요?{" "}
                                    <Link href="/login" className="text-primary underline-offset-4 hover:underline">
                                        로그인
                                    </Link>
                                </p>
                            </form>
                        </CardContent>
                    </Card>
                </div>
            </div>
        </div>
    );
}
