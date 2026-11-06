import type { ReactNode } from "react";

/* The honest status vocabulary of the /v4 page. Nothing is shown without one of these. */
export type Status = "LIVE" | "DEPLOYED" | "IN DEVELOPMENT" | "PLANNED" | "BUILDING TOWARD" | null;

export function StatusBadge({ status, children }: { status: Status; children?: ReactNode }) {
  return (
    <span className="v4-badge" data-status={status ?? "TO CONFIRM"}>
      {children ?? status ?? "TO CONFIRM"}
    </span>
  );
}
