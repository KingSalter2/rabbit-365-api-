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

export type LeadStatus = "new" | "contacted" | "won" | "lost" | "archived";

export type QuotationStatus = "draft" | "sent" | "accepted" | "rejected";

export type QuotationItemKind = "regular" | "discount" | "total";
