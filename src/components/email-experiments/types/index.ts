export type {
    Experiment,
    ExperimentConfig,
    Assignment,
    ArmSummary,
} from "@/lib/email-experiments/types";
export type ExperimentResults = Awaited<
    ReturnType<typeof import("@/lib/email-experiments/results").loadExperimentResults>
>;
export type ExperimentPreview = Awaited<
    ReturnType<typeof import("@/lib/email-experiments/preview").previewExperiment>
>;
export type ExperimentAction = <T>(url: string, body: unknown) => Promise<T | undefined>;
