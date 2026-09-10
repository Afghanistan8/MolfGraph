import type { ReactNode } from "react";
import { COUNTRIES } from "../config";

/** Shared primitives so every MolfGraph panel reads as one instrument. */

export function Panel({
  title,
  intro,
  actions,
  children,
}: {
  title: string;
  intro?: string;
  actions?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="panel">
      <header className="panel-head">
        <div>
          <h2>{title}</h2>
          {intro ? <p>{intro}</p> : null}
        </div>
        {actions ? <div className="row">{actions}</div> : null}
      </header>
      <div className="panel-body">{children}</div>
    </section>
  );
}

const TONE_BY_VALUE: Record<string, string> = {
  VERIFIED: "ok",
  ACCEPTED: "ok",
  ACTIVE: "ok",
  HIGH: "ok",
  DIRECT_REPLICATION: "ok",

  MEDIUM: "info",
  PENDING: "info",
  EXTENSION: "violet",
  MATERIAL_VARIANT: "info",

  CONFLICT: "bad",
  CONTRADICTORY_RESULT: "bad",
  REPAIR_REQUIRED: "bad",
  FAILED: "bad",

  UNAVAILABLE: "warn",
  INSUFFICIENT_EVIDENCE: "warn",
  REJECTED_AS_INSUFFICIENT: "warn",
  INSUFFICIENT: "warn",
  SUPERSEDED: "warn",
  LOW: "warn",

  INCOMPARABLE: "neutral",
  DUPLICATE: "neutral",
};

export function Pill({ value, prefix }: { value: string; prefix?: string }) {
  const tone = TONE_BY_VALUE[value] ?? "neutral";
  return (
    <span className={`pill pill-solid ${tone}`}>
      {prefix ? <span style={{ opacity: 0.6 }}>{prefix}</span> : null}
      {value.replaceAll("_", " ")}
    </span>
  );
}

export function Hash({ value, label }: { value?: string; label?: string }) {
  if (!value) return <span className="hash">not recorded</span>;
  return (
    <span className="hash" title={value}>
      {label ? `${label} ` : ""}
      {value.length > 20 ? `${value.slice(0, 10)}…${value.slice(-8)}` : value}
    </span>
  );
}

export function Field({
  label,
  hint,
  value,
  maxLength,
  children,
}: {
  label: string;
  hint?: string;
  value?: string;
  maxLength?: number;
  children: ReactNode;
}) {
  return (
    <label className="field">
      <span>
        {label}
        {maxLength ? (
          <em className="count">
            {(value ?? "").length}/{maxLength}
          </em>
        ) : null}
      </span>
      {children}
      {hint ? <span className="help">{hint}</span> : null}
    </label>
  );
}

export function CountrySelect({
  value,
  onChange,
  includeAny,
}: {
  value: string;
  onChange: (next: string) => void;
  includeAny?: boolean;
}) {
  return (
    <select value={value} onChange={(event) => onChange(event.target.value)}>
      {includeAny ? <option value="">Any jurisdiction</option> : null}
      {COUNTRIES.map((country) => (
        <option key={country.code} value={country.code}>
          {country.code} — {country.label}
        </option>
      ))}
    </select>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return <div className="empty">{children}</div>;
}

export function Notice({
  tone = "info",
  children,
}: {
  tone?: "info" | "warn" | "bad";
  children: ReactNode;
}) {
  return <div className={`notice ${tone}`}>{children}</div>;
}

export function Loading({ what }: { what: string }) {
  return <div className="spinner">Reading {what} from Bradbury…</div>;
}

export function Disclaimer({ text }: { text: string }) {
  return <div className="notice warn">{text}</div>;
}

export function shortAddress(address?: string): string {
  if (!address) return "—";
  return address.length > 12 ? `${address.slice(0, 6)}…${address.slice(-4)}` : address;
}
