import type { AnalysisKind } from "./types";

/**
 * Declarative descriptions of the eight source-grounded screening tools.
 *
 * The Screen panel renders itself from this table, so the UI and the contract
 * ABI cannot drift apart without the drift being visible in one file.
 */

export type FieldKind = "text" | "textarea" | "country" | "urls" | "number";

export interface ToolField {
  name: string;
  label: string;
  kind: FieldKind;
  placeholder?: string;
  required?: boolean;
  maxLength?: number;
  help?: string;
}

export interface ToolSpec {
  kind: AnalysisKind;
  functionName: string;
  label: string;
  summary: string;
  /** Order of the contract arguments. Values are read from the field names. */
  args: string[];
  fields: ToolField[];
}

const TRUSTED_URLS_FIELD: ToolField = {
  name: "trusted_urls",
  label: "Source override",
  kind: "urls",
  placeholder: "https://www.legislation.gov.uk/ukpga/1990/18/section/1",
  help:
    "Optional. One URL per line. Each origin must already be in the trusted registry, " +
    "otherwise the run is recorded as UNAVAILABLE.",
};

export const TOOLS: ToolSpec[] = [
  {
    kind: "verify_statute",
    functionName: "verify_statute",
    label: "Verify statute",
    summary: "Locate the official statute or code section that defines a charge.",
    args: ["crime_or_charge", "country", "trusted_urls"],
    fields: [
      {
        name: "crime_or_charge",
        label: "Crime or charge",
        kind: "text",
        placeholder: "Unauthorised access to computer material",
        required: true,
        maxLength: 160,
      },
      { name: "country", label: "Jurisdiction", kind: "country", required: true },
      TRUSTED_URLS_FIELD,
    ],
  },
  {
    kind: "screen_application",
    functionName: "screen_application",
    label: "Screen application",
    summary:
      "Check whether a described application of a law matches the published elements. Never judges guilt.",
    args: ["fact_pattern", "crime_or_charge", "country", "trusted_urls"],
    fields: [
      {
        name: "fact_pattern",
        label: "Described application",
        kind: "textarea",
        placeholder:
          "The charge was brought on the basis that shared credentials were reused after access was revoked.",
        required: true,
        maxLength: 4000,
      },
      {
        name: "crime_or_charge",
        label: "Crime or charge",
        kind: "text",
        required: true,
        maxLength: 160,
      },
      { name: "country", label: "Jurisdiction", kind: "country", required: true },
      TRUSTED_URLS_FIELD,
    ],
  },
  {
    kind: "extract_law_text",
    functionName: "extract_law_text",
    label: "Extract law text",
    summary:
      "Verbatim text of a provision under strict equivalence. Validators must agree byte-for-byte.",
    args: ["provision_or_citation", "country", "trusted_urls"],
    fields: [
      {
        name: "provision_or_citation",
        label: "Provision or citation",
        kind: "text",
        placeholder: "Computer Misuse Act 1990, s 1",
        required: true,
        maxLength: 160,
      },
      { name: "country", label: "Jurisdiction", kind: "country", required: true },
      TRUSTED_URLS_FIELD,
    ],
  },
  {
    kind: "compare_jurisdictions",
    functionName: "compare_jurisdictions",
    label: "Compare jurisdictions",
    summary: "Contrast how two jurisdictions treat the same topic or offence.",
    args: ["topic_or_crime", "country_a", "country_b", "trusted_urls"],
    fields: [
      {
        name: "topic_or_crime",
        label: "Topic or offence",
        kind: "text",
        required: true,
        maxLength: 160,
      },
      { name: "country_a", label: "Jurisdiction A", kind: "country", required: true },
      { name: "country_b", label: "Jurisdiction B", kind: "country", required: true },
      TRUSTED_URLS_FIELD,
    ],
  },
  {
    kind: "check_statute_of_limitations",
    functionName: "check_statute_of_limitations",
    label: "Check limitation period",
    summary: "Report the published limitation period and any tolling rules.",
    args: ["crime_or_charge", "country", "trusted_urls"],
    fields: [
      {
        name: "crime_or_charge",
        label: "Crime or charge",
        kind: "text",
        required: true,
        maxLength: 160,
      },
      { name: "country", label: "Jurisdiction", kind: "country", required: true },
      TRUSTED_URLS_FIELD,
    ],
  },
  {
    kind: "check_conflicts",
    functionName: "check_conflicts",
    label: "Check conflicts",
    summary:
      "In force, amended, repealed, superseded, or conflicting with another instrument.",
    args: ["citation_or_provision", "country", "trusted_urls"],
    fields: [
      {
        name: "citation_or_provision",
        label: "Citation or provision",
        kind: "text",
        required: true,
        maxLength: 160,
      },
      { name: "country", label: "Jurisdiction", kind: "country", required: true },
      TRUSTED_URLS_FIELD,
    ],
  },
  {
    kind: "map_facts_to_provisions",
    functionName: "map_facts_to_provisions",
    label: "Map facts to provisions",
    summary: "Candidate published provisions a lawyer should review for a fact pattern.",
    args: ["fact_pattern", "country", "trusted_urls"],
    fields: [
      {
        name: "fact_pattern",
        label: "Fact pattern",
        kind: "textarea",
        required: true,
        maxLength: 4000,
      },
      { name: "country", label: "Jurisdiction", kind: "country", required: true },
      TRUSTED_URLS_FIELD,
    ],
  },
  {
    kind: "generate_verification_report",
    functionName: "generate_verification_report",
    label: "Verification report",
    summary: "Audit a pinned study version against the official sources.",
    args: ["study_id", "version", "country"],
    fields: [
      { name: "study_id", label: "Study id", kind: "number", required: true },
      { name: "version", label: "Version", kind: "number", required: true },
      { name: "country", label: "Jurisdiction", kind: "country", required: true },
    ],
  },
];

export const TOOL_BY_KIND: Record<string, ToolSpec> = Object.fromEntries(
  TOOLS.map((tool) => [tool.kind, tool]),
);

/** Turn a textarea of URLs into the JSON array the contract expects. */
export function encodeUrls(raw: string): string {
  const urls = raw
    .split(/[\n,]/)
    .map((value) => value.trim())
    .filter(Boolean);
  return urls.length ? JSON.stringify(urls) : "";
}
