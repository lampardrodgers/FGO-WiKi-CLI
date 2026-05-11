export type Region = "CN" | "JP" | "NA" | "KR" | "TW";

export interface SourceRef {
  source: "atlas" | "mooncell" | "local";
  region?: Region;
  url?: string;
  fetchedAt?: string;
  hash?: string;
}

export interface EntityRecord {
  region: Region;
  entityType: string;
  entityId: string;
  collectionNo?: number | null;
  name: string;
  originalName?: string | null;
  aliases: string[];
  summary: string;
  rawJson: unknown;
  sourceUrl: string;
  updatedAt: string;
}

export interface EntityResult {
  region: Region;
  entityType: string;
  entityId: string;
  collectionNo?: number | null;
  name: string;
  aliases: string[];
  summary: string;
  sourceRefs: SourceRef[];
}

export interface ServantResult {
  region: Region;
  servantId: string;
  collectionNo?: number | null;
  name: string;
  className?: string;
  rarity?: number;
  traits: string[];
  matchedTerms: string[];
  sourceRefs: SourceRef[];
}

export interface EffectMatch {
  region: Region;
  servant: {
    servantId: string;
    collectionNo?: number | null;
    name: string;
    className?: string;
    rarity?: number;
  };
  sourceType: string;
  sourceName: string;
  sourceId?: string;
  buffType: string;
  buffName: string;
  detail?: string;
  target?: string;
  duration?: string;
  sourceRefs: SourceRef[];
}

export interface BannerResult {
  region: Region;
  title: string;
  startAt?: string;
  endAt?: string;
  pickupServants: string[];
  pickupCEs: string[];
  confidence: "official" | "ingame" | "prediction" | "unknown";
  sourceUrl: string;
  sourceRefs: SourceRef[];
}

export interface QuestBondResult {
  region: Region;
  questId: string;
  phase: number;
  name: string;
  spotName?: string;
  warId?: string;
  warName?: string;
  questType?: string;
  consumeType?: string;
  consume?: number;
  bond: number;
  exp?: number;
  openedAt?: string;
  closedAt?: string;
  sourceUrl: string;
  sourceRefs: SourceRef[];
}

export interface QuestIndexAudit {
  region: Region;
  totalWars: number;
  totalQuests: number;
  skippedEventWars: number;
  candidateQuests: number;
  indexedQuests: number;
  failedQuestDetails: number;
  skippedReasons: Record<string, number>;
  consumeTypes: Record<string, number>;
  unknownConsumeTypes: string[];
  updatedAt: string;
}

export interface DoctorCheck {
  id: string;
  ok: boolean;
  severity: "info" | "warning" | "error";
  message: string;
  detail?: unknown;
}

export interface DoctorReport {
  version: string;
  dbPath: string;
  region: Region;
  ok: boolean;
  checks: DoctorCheck[];
  questAudit?: QuestIndexAudit;
  topBondQuests: QuestBondResult[];
}

export interface ResourceLink {
  region: Region;
  ownerType: string;
  ownerId: string;
  assetType: string;
  url: string;
  sourceRegion?: Region;
  sourceRefs: SourceRef[];
}

export interface SyncOptions {
  regions: Region[];
  dataDir?: string;
  includeBasic?: boolean;
  includeNice?: boolean;
  includeMooncell?: boolean;
  includeAssets?: boolean;
  concurrency?: number;
  force?: boolean;
  verbose?: boolean;
}

export interface SearchOptions {
  region?: Region;
  entityType?: string;
  limit?: number;
}
