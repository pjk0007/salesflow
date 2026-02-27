"use client";

import { Suspense, useState, useEffect, type FormEvent } from "react";
import { useRouter, useSearchParams } from "next/navigation";
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

function InvitePageContent() {
    const router = useRouter();
    const searchParams = useSearchParams();
    const { refreshSession } = useSession();
    const token = searchParams.get("token") as string;

    const [inviteInfo, setInviteInfo] = useState<{ email: string; role: string } | null>(null);
    const [name, setName] = useState("");
    const [password, setPassword] = useState("");
    const [error, setError] = useState("");
    const [validating, setValidating] = useState(true);
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [invalid, setInvalid] = useState(false);

    useEffect(() => {
        if (!token) return;

        fetch(`/api/org/invitations/accept?token=${token}`)
            .then((res) => res.json())
            .then((data) => {
                if (data.success) {
                    setInviteInfo(data.data);
                } else {
                    setInvalid(true);
                    setError(data.error || "유효하지 않은 초대입니다.");
                }
            })
            .catch(() => {
                setInvalid(true);
                setError("서버에 연결할 수 없습니다.");
            })
            .finally(() => setValidating(false));
    }, [token]);

    const handleSubmit = async (e: FormEvent) => {
        e.preventDefault();
        setError("");

        if (!name.trim()) {
            setError("이름을 입력해주세요.");
            return;
        }
        if (password.length < 6) {
            setError("비밀번호는 6자 이상이어야 합니다.");
            return;
        }

        setIsSubmitting(true);
        try {
            const res = await fetch("/api/org/invitations/accept", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ token, name: name.trim(), password }),
            });
            const data = await res.json();

            if (data.success) {
                await refreshSession();
                router.push("/");
            } else {
                setError(data.error || "가입에 실패했습니다.");
            }
        } catch {
            setError("서버에 연결할 수 없습니다.");
        } finally {
            setIsSubmitting(false);
        }
    };

    if (!token || validating) {
        return (
            <div className="flex min-h-screen items-center justify-center bg-muted/30">
                <p className="text-muted-foreground">확인 중...</p>
            </div>
        );
    }

    if (invalid) {
        return (
            <div className="flex min-h-screen items-center justify-center bg-muted/30">
                <Card className="w-full max-w-md">
                    <CardHeader className="text-center">
                        <CardTitle>초대 링크 오류</CardTitle>
                        <CardDescription>{error}</CardDescription>
                    </CardHeader>
                    <CardContent className="text-center">
                        <Button variant="outline" onClick={() => router.push("/login")}>
                            로그인 페이지로 이동
                        </Button>
                    </CardContent>
                </Card>
            </div>
        );
    }

    return (
        <div className="flex min-h-screen items-center justify-center bg-muted/30">
            <Card className="w-full max-w-md">
                <CardHeader className="text-center">
                    <CardTitle>초대 수락</CardTitle>
                    <CardDescription>
                        {inviteInfo?.email}으로 초대되었습니다. 계정을 만들어주세요.
                    </CardDescription>
                </CardHeader>
                <CardContent>
                    <form onSubmit={handleSubmit} className="space-y-4">
                        <div className="space-y-1.5">
                            <Label>이메일</Label>
                            <Input value={inviteInfo?.email ?? ""} disabled />
                        </div>

                        <div className="space-y-1.5">
                            <Label>
                                이름 <span className="text-destructive">*</span>
                            </Label>
                            <Input
                                value={name}
                                onChange={(e) => setName(e.target.value)}
                                placeholder="이름"
                            />
                        </div>

                        <div className="space-y-1.5">
                            <Label>
                                비밀번호 <span className="text-destructive">*</span>
                            </Label>
                            <Input
                                type="password"
                                value={password}
                                onChange={(e) => setPassword(e.target.value)}
                                placeholder="6자 이상"
                            />
                        </div>

                        {error && (
                            <p className="text-sm text-destructive">{error}</p>
                        )}

                        <Button type="submit" className="w-full" disabled={isSubmitting}>
                            {isSubmitting ? "가입 중..." : "가입하기"}
                        </Button>
                    </form>
                </CardContent>
            </Card>
        </div>
    );
}

export default function InvitePage() {
    return (
        <Suspense
            fallback={
                <div className="flex min-h-screen items-center justify-center bg-muted/30">
                    <p className="text-muted-foreground">확인 중...</p>
                </div>
            }
        >
            <InvitePageContent />
        </Suspense>
    );
}
