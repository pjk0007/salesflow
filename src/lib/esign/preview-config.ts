import { isDevelopmentPreviewRuntime } from "../development-runtime";

export function isEsignPreviewRuntime(env: Record<string, string | undefined>) {
    return isDevelopmentPreviewRuntime(env) && env.ESIGN_PREVIEW === "on";
}
