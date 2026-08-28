// Barrel re-export — all consumers keep `import { ... } from "@/lib/ai"`

// Types & client
export { getAiClient, getSearchAiClient, type AiClient } from "./client";
export { AI_MODELS, DEFAULT_MODEL_ID, SEARCH_MODEL_ID, resolveModel, type AiModelOption, type AiProvider } from "./models";

// JSON utilities (internal, but buildEmailSystemPrompt uses extractJson indirectly)
export { extractJson } from "./json-utils";

// Email
export { buildEmailSystemPrompt, generateEmail, type GenerateEmailInput } from "./email";

// Search (product, company research, field enrichment)
export { generateProduct } from "./search";
export { generateCompanyResearch, type CompanyResearchResult } from "./search";
export { generateFieldEnrichment } from "./search";

// Web form
export { generateWebForm } from "./form";

// Alimtalk
export { generateAlimtalk } from "./alimtalk";

// Quota & usage
export { checkTokenQuota, updateTokenUsage, getUsageData, logAiUsage } from "./quota";
