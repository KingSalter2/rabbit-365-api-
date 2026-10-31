export type AdminRole = "superadmin" | "admin";

export type SessionUser = {
  id: string;
  email: string | null;
};

export type AdminUser = {
  id: string;
  email: string;
  role: AdminRole;
  fullName: string | null;
};

export type ClientRole = "admin" | "member";

export type ClientSession = {
  userId: string;
  email: string;
  memberId: string;
  orgId: string;
  orgName: string;
  role: ClientRole;
  fullName: string | null;
  orgStatus: "active" | "suspended" | "archived";
  supportEnabled: boolean;
};

export type SupportStatus =
  | "open"
  | "in_progress"
  | "waiting_on_client"
  | "resolved"
  | "closed";

export type SupportCategory = "support" | "maintenance" | "bug" | "request" | "other";

export type SupportPriority = "low" | "normal" | "high" | "urgent";

export type SupportAuthorType = "client" | "agent" | "system";

export type LeadStatus = "new" | "contacted" | "won" | "lost" | "archived";

export type QuotationStatus = "draft" | "sent" | "accepted" | "rejected";

export type QuotationItemKind = "regular" | "discount" | "total";
