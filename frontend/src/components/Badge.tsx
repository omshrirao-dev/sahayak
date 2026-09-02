const RISK_STYLES: Record<string, string> = {
  Stable: "bg-emerald-100 text-emerald-800 ring-emerald-600/20",
  Watch: "bg-amber-100 text-amber-800 ring-amber-600/20",
  Crisis: "bg-red-100 text-red-800 ring-red-600/20",
};

const ENGAGEMENT_STYLES: Record<string, string> = {
  Active: "bg-sky-100 text-sky-800 ring-sky-600/20",
  Unresponsive: "bg-amber-100 text-amber-800 ring-amber-600/20",
  Disengaged: "bg-slate-200 text-slate-700 ring-slate-500/20",
};

const CARE_STAGE_STYLES: Record<string, string> = {
  Intake: "bg-violet-100 text-violet-800 ring-violet-600/20",
  "Active Care": "bg-sky-100 text-sky-800 ring-sky-600/20",
  Maintenance: "bg-teal-100 text-teal-800 ring-teal-600/20",
  Discharged: "bg-slate-200 text-slate-700 ring-slate-500/20",
};

const TIER_STYLES: Record<string, string> = {
  LOW: "bg-slate-100 text-slate-700 ring-slate-500/20",
  MEDIUM: "bg-amber-100 text-amber-800 ring-amber-600/20",
  HIGH: "bg-red-100 text-red-800 ring-red-600/20",
};

const STATUS_STYLES: Record<string, string> = {
  proposed: "bg-amber-100 text-amber-800 ring-amber-600/20",
  approved: "bg-sky-100 text-sky-800 ring-sky-600/20",
  executing: "bg-sky-100 text-sky-800 ring-sky-600/20",
  completed: "bg-emerald-100 text-emerald-800 ring-emerald-600/20",
  superseded: "bg-slate-200 text-slate-700 ring-slate-500/20",
  cancelled: "bg-slate-200 text-slate-700 ring-slate-500/20",
};

function Pill({ label, className }: { label: string; className: string }) {
  return (
    <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ring-1 ring-inset ${className}`}>
      {label}
    </span>
  );
}

export function RiskBadge({ level }: { level: string }) {
  return <Pill label={level} className={RISK_STYLES[level] ?? "bg-slate-100 text-slate-700 ring-slate-500/20"} />;
}
export function EngagementBadge({ status }: { status: string }) {
  return <Pill label={status} className={ENGAGEMENT_STYLES[status] ?? "bg-slate-100 text-slate-700 ring-slate-500/20"} />;
}
export function CareStageBadge({ stage }: { stage: string }) {
  return <Pill label={stage} className={CARE_STAGE_STYLES[stage] ?? "bg-slate-100 text-slate-700 ring-slate-500/20"} />;
}
export function TierBadge({ tier }: { tier: string }) {
  return <Pill label={tier} className={TIER_STYLES[tier] ?? "bg-slate-100 text-slate-700 ring-slate-500/20"} />;
}
export function StatusBadge({ status }: { status: string }) {
  return <Pill label={status} className={STATUS_STYLES[status] ?? "bg-slate-100 text-slate-700 ring-slate-500/20"} />;
}
