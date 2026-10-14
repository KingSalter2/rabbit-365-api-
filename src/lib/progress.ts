export type ProgressStatus = "pending" | "in_progress" | "done";

export type ProjectStatus =
  | "awaiting_deposit"
  | "in_progress"
  | "completed"
  | "cancelled";

export type ProgressStepInput = {
  position: number;
  label: string;
  description?: string;
  status: ProgressStatus;
  note?: string;
};

/** The standard stages every Rabbit 365 project moves through. */
export const DEFAULT_PROGRESS_STEPS = [
  { label: "Discovery & planning", description: "Confirm scope, milestones and kick-off details." },
  { label: "Design", description: "Wireframes and UI design for review and sign-off." },
  { label: "Development", description: "Build, integrate and test the agreed deliverables." },
  { label: "Testing & QA", description: "Security, responsive and functionality checks." },
  { label: "Handover", description: "Deployment, documentation and final handover." },
];

/** Rows to insert when a project starts (all stages pending). */
export function defaultProgressRows(quotationId: string) {
  return DEFAULT_PROGRESS_STEPS.map((step, index) => ({
    quotation_id: quotationId,
    position: index,
    label: step.label,
    description: step.description,
    status: "pending" as ProgressStatus,
  }));
}

export const PROJECT_STATUS_LABELS: Record<ProjectStatus, string> = {
  awaiting_deposit: "Awaiting deposit",
  in_progress: "In progress",
  completed: "Completed",
  cancelled: "Cancelled",
};
