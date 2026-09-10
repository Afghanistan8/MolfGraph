/**
 * TypeScript mirrors of the JSON schemas the MolfGraph contract stores.
 *
 * Every field here exists on-chain. The frontend never invents a field, never
 * derives a relation, and never upgrades a status.
 */

export type AnalysisStatus =
  | "VERIFIED"
  | "INSUFFICIENT_EVIDENCE"
  | "UNAVAILABLE"
  | "CONFLICT";

export type Confidence = "LOW" | "MEDIUM" | "HIGH";

export type Bucket = "LOW" | "MEDIUM" | "HIGH";

export type RecordType =
  | "CRIME"
  | "JUDGEMENT"
  | "QUESTION"
  | "METHOD"
  | "CONCLUSION";

export type RelationType =
  | "DIRECT_REPLICATION"
  | "MATERIAL_VARIANT"
  | "EXTENSION"
  | "CONTRADICTORY_RESULT"
  | "INCOMPARABLE"
  | "INSUFFICIENT";

export type ClaimStatus =
  | "PENDING"
  | "ACCEPTED"
  | "REJECTED_AS_INSUFFICIENT"
  | "REPAIR_REQUIRED"
  | "DUPLICATE";

export type AnalysisKind =
  | "verify_statute"
  | "screen_application"
  | "extract_law_text"
  | "compare_jurisdictions"
  | "check_statute_of_limitations"
  | "check_conflicts"
  | "map_facts_to_provisions"
  | "generate_verification_report";

export interface NeighborRecord {
  record_id: string;
  study_id: number;
  version: number;
  record_type: RecordType;
  text: string;
  distance: number;
}

export interface AnalysisResult {
  kind: AnalysisKind;
  status: AnalysisStatus;
  citation: string;
  citation_key: string;
  exact_text_or_summary: string;
  applicability_score: number;
  applicability_bucket: Bucket;
  confidence: Confidence;
  sources: string[];
  source_set_sha256: string;
  notes: string;
  disclaimer: string;
  study_id: number;
  study_version: number;
  analysis_id?: number;
  country?: string;
  creator?: string;
  created_at?: string;
  seq?: number;
  inputs_sha256?: string;
  case_id?: number;
  neighbors_context_only?: NeighborRecord[];
}

export interface StudyRecord {
  record_id: string;
  record_type: RecordType;
  text: string;
  source_uris: string[];
  expected_sha256: string[];
}

export interface StudyVersion {
  study_id: number;
  version: number;
  parent_version: number;
  title: string;
  country: string;
  subject_ref: string;
  crime_or_charge: string;
  question: string;
  method: string;
  conclusion: string;
  records: StudyRecord[];
  creator: string;
  correction_note: string;
  content_sha256: string;
  created_at: string;
  seq: number;
  status: "ACTIVE" | "SUPERSEDED";
  superseded_by?: number;
  disclaimer: string;
}

export interface StudySummary {
  study_id: number;
  title: string;
  country: string;
  crime_or_charge: string;
  creator: string;
  created_at: string;
  latest_version: number;
  versions: number[];
}

export interface Evidence {
  evidence_id: number;
  stable_record_id: string;
  source_uri: string;
  expected_sha256: string;
  version: number;
  publisher_origin: string;
  issued_at: string;
  record_type: RecordType | "";
  mode: "REGISTER" | "REPAIR";
  observed_at: string;
  creator: string;
  seq: number;
}

export interface ClaimDecision {
  status: "ACCEPTED" | "REJECTED_AS_INSUFFICIENT" | "REPAIR_REQUIRED";
  relation_type: RelationType;
  confidence: Confidence;
  evidence_pass: boolean;
  source_set_sha256: string;
  failure_code: string;
  failed_evidence_id: number;
  observed_sha256: string;
  rationale: string;
}

export interface RelationClaim {
  claim_id: number;
  from_study_id: number;
  from_version: number;
  to_study_id: number;
  to_version: number;
  claimed_relation: RelationType;
  evidence_ids: number[];
  status: ClaimStatus;
  from_content_sha256: string;
  to_content_sha256: string;
  from_status: string;
  to_status: string;
  proposer: string;
  created_at: string;
  seq: number;
  disclaimer: string;
  decided_at?: string;
  decision?: ClaimDecision;
  edge_id?: number;
}

export interface GraphEdge {
  edge_id: number;
  claim_id: number;
  relation_type: RelationType;
  from_study_id: number;
  from_version: number;
  to_study_id: number;
  to_version: number;
  status: "ACCEPTED";
  confidence: Confidence;
  source_set_sha256: string;
  evidence_pass: boolean;
  evidence_ids: number[];
  rationale: string;
  created_at: string;
  seq: number;
  disclaimer: string;
}

export interface GraphNode {
  node_id: string;
  study_id: number;
  version: number;
  title: string;
  country: string;
  crime_or_charge: string;
  status: "ACTIVE" | "SUPERSEDED";
  content_sha256: string;
  record_types: RecordType[];
}

export interface Graph {
  nodes: GraphNode[];
  edges: GraphEdge[];
  note: string;
  disclaimer: string;
}

export interface Receipt {
  receipt_id: number;
  kind: "STUDY_VERSION" | "CORRECTION" | "ANALYSIS" | "EDGE" | "ALERT";
  actor: string;
  study_ids: number[];
  versions: number[];
  content_sha256: string;
  source_set_sha256: string;
  tx_context: string;
  created_at: string;
  seq: number;
}

export interface Alert {
  alert_id: number;
  kind: string;
  severity: "LOW" | "MEDIUM" | "HIGH";
  message: string;
  refs: Record<string, unknown>;
  actor: string;
  created_at: string;
  seq: number;
}

export interface CaseRecord {
  case_id: number;
  title: string;
  country: string;
  matter_ref: string;
  notes: string;
  analysis_ids: number[];
  creator: string;
  created_at: string;
  seq: number;
  restricted: boolean;
  disclaimer: string;
}

export interface Stats {
  total_studies: number;
  total_versions: number;
  total_analyses: number;
  total_edges: number;
  total_claims: number;
  total_evidence: number;
  total_receipts: number;
  total_cases: number;
  stat_verified: number;
  stat_unavailable: number;
  stat_insufficient: number;
  stat_conflicts: number;
  stat_low_confidence: number;
  stat_alerts: number;
  stat_hash_mismatch: number;
  owner: string;
  disclaimer: string;
}

export interface Page<T> {
  total: number;
  items: T[];
}

export type TxPhase = "idle" | "submitted" | "pending" | "finalized" | "failed";

export interface TxState {
  phase: TxPhase;
  hash?: string;
  message?: string;
}

export interface SampleStudy {
  title: string;
  country: string;
  subject_ref: string;
  crime_or_charge: string;
  question: string;
  method: string;
  conclusion: string;
  records: Array<{
    record_type: RecordType;
    text: string;
    source_uris: string[];
    expected_sha256: string[];
  }>;
}

export interface SampleRelation {
  from_title: string;
  to_title: string;
  claimed_relation: RelationType;
  rationale: string;
}

export interface SampleData {
  disclaimer: string;
  studies: SampleStudy[];
  proposed_relations: SampleRelation[];
}
