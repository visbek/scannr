export type EngineResult = {
  appeared: boolean;
  snippet: string;
  status?: "success" | "failed" | "unavailable" | "unverified";
  sentiment?: "positive" | "neutral" | "negative";
  evidence?: { text: string; citations: string[] };
  factCheck?: { accurate: boolean | null; issue?: string };
};

export type TrustSignals = {
  trustpilot: { exists: boolean; rating?: number; count?: number; url?: string };
  g2: { exists: boolean; rating?: number; count?: number };
  capterra: { exists: boolean; rating?: number };
  indiamartListing?: { exists: boolean; url?: string };
  marketplaceListing?: { exists: boolean; url?: string };
  faqPage: { exists: boolean; url?: string; questions?: string[] };
  aboutPage: {
    exists: boolean;
    hasExperience: boolean;
    hasCustomerCount: boolean;
    hasCertifications: boolean;
    hasAwards: boolean;
  };
  pressmentions: { exists: boolean; sources?: string[] };
  redditMentions: { exists: boolean; sentiment?: string; count?: number };
  medium: { exists: boolean };
  substack: { exists: boolean };
  youtube: { exists: boolean; videoCount?: number; channelUrl?: string };
  linkedinPage?: { exists: boolean; url?: string };
  competitors: string[];
  customerLanguage: string[];
};

export type Category =
  | "informational"
  | "discovery"
  | "commercial"
  | "transactional";

export type PromptResult = {
  prompt: string;
  category: Category;
  gemini: EngineResult;
  claude: EngineResult;
  chatgpt: EngineResult;
  perplexity: EngineResult;
  sentiment?: "positive" | "neutral" | "negative";
};

export type EngineInfo = { score: number | null; available: boolean; weight?: number; successful?: number; attempted?: number };

export type BusinessProfile = {
  companyName: string;
  whatTheySell: string;
  industry: string;
  geography: string;
  businessModel: string;
};

export type ICP = {
  primaryBuyer: string;
  buyerLocation: string;
  buyerCompanySize: string;
  buyerPainPoint: string;
  buyerContext: string;
};

export type CategoryScore = { appeared: number; total: number };

export type PromptQuality = {
  highCount: number;
  totalCount: number;
  indicator: "high" | "medium" | "low";
};

export type ScanData = {
  usage?: import("../../lib/scan-usage").ScanUsage;
  overallScore: number | null;
  methodologyVersion?: string;
  coverage?: { successful: number; total: number };
  comparisonScore?: number | null;
  comparisonCoverage?: { successful: number; total: number };
  reportId?: string;
  saveStatus?: "saved" | "failed" | "anonymous";
  createdAt?: string;
  domain?: string;
  businessProfile: BusinessProfile;
  icp: ICP;
  engines: Record<"gemini" | "claude" | "chatgpt" | "perplexity", EngineInfo>;
  engineErrors?: Record<"gemini" | "claude" | "chatgpt" | "perplexity", boolean>;
  categoryScores: Record<Category, CategoryScore>;
  results: PromptResult[];
  trustSignals?: TrustSignals;
  promptQuality?: PromptQuality;
  businessType?: 'software' | 'physical' | 'service';
  competitorResults?: Record<string, {
    domain: string;
    score: number | null;
    appeared: number;
    total: number;
  }>;
  factCheckSummary?: {
    totalCited: number;
    accurate: boolean | null;
    checked?: number;
    issues: string[];
  };
  contentRecommendations?: Array<{
    priority: "high" | "medium" | "low";
    type: string;
    title: string;
    description: string;
    expectedImpact: string;
  }>;
};

export type ScanHistoryEntry = {
  created_at: string;
  score: number;
  gemini_score: number | null;
  claude_score: number | null;
  chatgpt_score: number | null;
  perplexity_score: number | null;
};

export type ScanStatus =
  | "idle"
  | "generating"
  | "scanning"
  | "done"
  | "error";

export type EngineState = "idle" | "scanning" | "analyzing" | "done";
