import { getStore } from "@/lib/store";
import type {
  Assessment,
  CompanyPlaybook,
  MessageTemplate,
  Sequence,
  AuditEntry,
  Conversation,
  Experiment,
  Gift,
  GiftCampaign,
  PlatformSettings,
  ProofStory,
  Rep,
  Suppression,
  User,
} from "@/lib/types";
import { nowIso } from "@/lib/util";

/** Typed repositories over the store's generic document collections. */
function col<T extends { id: string }>(name: string) {
  return {
    name,
    get: (id: string) => getStore().getDoc<T>(name, id),
    list: () => getStore().listDocs<T>(name),
    put: (doc: T) => getStore().putDoc<T>(name, doc),
    remove: (id: string) => getStore().deleteDoc(name, id),
  };
}

export const reps = col<Rep>("reps");
export const users = col<User>("users");
export const conversations = col<Conversation>("conversations");
export const experiments = col<Experiment>("experiments");
export const proofStories = col<ProofStory>("proof");
export const giftCampaigns = col<GiftCampaign>("gift_campaigns");
export const gifts = col<Gift>("gifts");
export const assessments = col<Assessment>("assessments");
export const suppressions = col<Suppression>("suppressions");
export const auditLog = col<AuditEntry>("audit");
export const messageTemplates = col<MessageTemplate>("message_templates");
export const sequences = col<Sequence>("sequences");
export const companyPlaybook = col<CompanyPlaybook>("company_playbook");
const settingsCol = col<PlatformSettings>("settings");

export const DEFAULT_SETTINGS: PlatformSettings = {
  id: "global",
  automation: {
    autoSendEmail: true,
    autoLaunchCampaigns: true,
    autoProposeGifts: true,
    requireFollowUpApproval: true,
    signalFreshnessDays: 90,
    qualificationThreshold: 70,
    hotThreshold: 60,
  },
  economics: {
    repFullyLoadedMonthly: 9500,
    toolingMonthly: 1200,
    videoCostPerRender: 2.5,
    avgOpportunityValue: 120_000,
    meetingHoldRate: 0.7,
  },
  // One explicit default per setting. The Lab changes these only for enrolled accounts, and a rolled-out winner updates them.
  defaults: {
    contentFormat: "landing_page",
    videoType: "ai",
    personalization: "deep",
    angleVariant: "A",
    gifting: "control",
    proofMode: "matched",
    assessmentInvite: false,
    angleOverride: null,
  },
  updatedAt: "1970-01-01T00:00:00.000Z",
  updatedBy: "defaults",
};

export async function getSettings(): Promise<PlatformSettings> {
  const s = await settingsCol.get("global");
  if (!s) return DEFAULT_SETTINGS;
  return { ...DEFAULT_SETTINGS, ...s, automation: { ...DEFAULT_SETTINGS.automation, ...s.automation }, economics: { ...DEFAULT_SETTINGS.economics, ...s.economics }, defaults: { ...DEFAULT_SETTINGS.defaults, ...(s.defaults ?? {}) } };
}

export async function updateSettings(patch: Partial<Pick<PlatformSettings, "automation" | "economics" | "defaults">>, by: string): Promise<PlatformSettings> {
  const current = await getSettings();
  const next: PlatformSettings = {
    ...current,
    automation: { ...current.automation, ...(patch.automation ?? {}) },
    economics: { ...current.economics, ...(patch.economics ?? {}) },
    defaults: { ...current.defaults, ...(patch.defaults ?? {}) },
    updatedAt: nowIso(),
    updatedBy: by,
  };
  await settingsCol.put(next);
  return next;
}

/** Listing helpers used across workspaces. */
export async function conversationsFor(accountId: string): Promise<Conversation[]> {
  return (await conversations.list()).filter((c) => c.accountId === accountId).sort((a, b) => b.at.localeCompare(a.at));
}

export async function isSuppressed(email: string | undefined, domain: string): Promise<Suppression | null> {
  const all = await suppressions.list();
  const e = email?.toLowerCase();
  const d = `@${domain.toLowerCase().replace(/^www\./, "")}`;
  return all.find((s) => s.target.toLowerCase() === e || s.target.toLowerCase() === d) ?? null;
}
