"use client";
import * as React from "react";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "./tooltip";

/**
 * 아이콘 버튼에 마우스를 올리면 바로 뜨는 설명 (브라우저 기본 title은 늦게 뜨거나 안 보인다).
 * 버튼이 꺼져(disabled) 있어도 설명이 뜨도록 감싸는 span에 붙인다.
 */
export function Hint({ label, children, side = "bottom" }: { label: React.ReactNode; children: React.ReactElement; side?: "top" | "bottom" | "left" | "right" }) {
    const disabled = (children.props as { disabled?: boolean }).disabled;
    return (
        <TooltipProvider delayDuration={150}>
            <Tooltip>
                <TooltipTrigger asChild>{disabled ? <span className="inline-flex">{children}</span> : children}</TooltipTrigger>
                <TooltipContent side={side} sideOffset={4}>
                    {label}
                </TooltipContent>
            </Tooltip>
        </TooltipProvider>
    );
}
