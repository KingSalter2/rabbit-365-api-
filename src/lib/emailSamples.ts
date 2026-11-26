import {
  brandLogoUrl,
  clientInviteEmail,
  clientRegisteredTeamEmail,
  funeralOutreachEmail,
  leadConfirmationEmail,
  leadNotificationEmail,
  passwordResetEmail,
  quotationAcceptanceClientEmail,
  quotationAcceptedTeamEmail,
  quotationProgressEmail,
  supportTicketAutoClosedClient,
  supportTicketCreatedClient,
  supportTicketCreatedTeam,
  supportTicketReminderClient,
  supportTicketReplyClient,
  supportTicketReplyTeam,
  supportTicketStatusClient,
  type EmailContent,
} from "./emails";
import type { BankingDetails } from "./settings";

export type SampleEmailKey =
  | "lead"
  | "lead-client"
  | "quotation-team"
  | "quotation-client"
  | "quotation-progress"
  | "client-invite"
  | "password-reset"
  | "client-registered-team"
  | "support-ticket-client"
  | "support-ticket-team"
  | "support-reply-client"
  | "support-reply-team"
  | "support-status"
  | "support-reminder"
  | "support-auto-closed"
  | "funeral-outreach";

export type SampleEmailMeta = {
  key: SampleEmailKey;
  label: string;
  description: string;
};

export const SAMPLE_EMAILS: SampleEmailMeta[] = [
  {
    key: "lead",
    label: "New enquiry (team)",
    description: "Sent to the Rabbit 365 team whenever a website form is submitted.",
  },
  {
    key: "lead-client",
    label: "Enquiry received (client)",
    description: "Confirmation sent to the person who submitted a website form.",
  },
  {
    key: "quotation-team",
    label: "Quotation accepted (team)",
    description: "Sent to the team the moment a client accepts a quotation.",
  },
  {
    key: "quotation-client",
    label: "Quotation accepted (client)",
    description: "Confirmation sent to the client after they accept a quotation.",
  },
  {
    key: "quotation-progress",
    label: "Project progress (client)",
    description: "Sent to the client whenever their project progress is updated.",
  },
  {
    key: "client-invite",
    label: "Portal invite (client)",
    description: "Sent to a client when the team invites them to the support portal.",
  },
  {
    key: "password-reset",
    label: "Password reset (admin)",
    description: "Sent when an admin requests a password reset link.",
  },
  {
    key: "client-registered-team",
    label: "Client registered (team)",
    description: "Sent to the team when a client completes portal registration.",
  },
  {
    key: "funeral-outreach",
    label: "Funeral outreach (manual send)",
    description: "Editable outreach template for funeral parlour website services.",
  },
  {
    key: "support-ticket-client",
    label: "Ticket received (client)",
    description: "Confirmation sent to the client when they raise a support ticket.",
  },
  {
    key: "support-ticket-team",
    label: "New ticket (team)",
    description: "Sent to the team whenever a client raises a support ticket.",
  },
  {
    key: "support-reply-client",
    label: "Agent reply (client)",
    description: "Sent to the client when the team replies to their ticket.",
  },
  {
    key: "support-reply-team",
    label: "Client reply (team)",
    description: "Sent to the team when a client replies to a ticket.",
  },
  {
    key: "support-status",
    label: "Ticket status changed (client)",
    description: "Sent to the client when the team changes a ticket status.",
  },
  {
    key: "support-reminder",
    label: "Waiting-on-client reminder (client)",
    description: "Sent once after 3 business days when a ticket is waiting on the client.",
  },
  {
    key: "support-auto-closed",
    label: "Ticket auto-closed (client)",
    description: "Sent when a waiting-on-client ticket is closed after no reply.",
  },
];

/** Render a template with representative sample data for previewing. */
export function renderSampleEmail(
  key: string,
  baseUrl: string,
  banking?: BankingDetails | null,
): EmailContent | null {
  const base = (baseUrl || "https://www.rabbit365.co.za").replace(/\/$/, "");
  const portalUrl = `${base}/ops`;
  const logoUrl = brandLogoUrl(base);

  switch (key) {
    case "lead":
      return leadNotificationEmail(
        {
          name: "Naledi Molefe",
          email: "naledi@brightideaco.co.za",
          phone: "+27 82 123 4567",
          company: "Bright Idea Co.",
          service: "Web Development",
          budget: "R25 000",
          category: "web-development",
          formType: "service-inquiry",
          message:
            "Hi Rabbit 365,\n\nWe're looking to rebuild our company website and would love a quote. We'd also like help with SEO.\n\nThanks,\nNaledi",
        },
        { portalUrl, logoUrl },
      );
    case "lead-client":
      return leadConfirmationEmail(
        {
          name: "Naledi Molefe",
          email: "naledi@brightideaco.co.za",
          phone: "+27 82 123 4567",
          company: "Bright Idea Co.",
          service: "Web Development",
          budget: "R25 000",
          category: "web-development",
          formType: "service-inquiry",
          message:
            "Hi Rabbit 365,\n\nWe're looking to rebuild our company website and would love a quote. We'd also like help with SEO.\n\nThanks,\nNaledi",
        },
        { logoUrl, siteUrl: base },
      );
    case "quotation-team":
      return quotationAcceptedTeamEmail({
        quoteNumber: "R365-2026-0002",
        title: "STARTER BUSINESS WEBSITE",
        acceptedByName: "Sampolile",
        company: "Demo Business (Pty) Ltd",
        clientEmail: "sampolile@gmail.com",
        total: "R10 000,00",
        acceptedAt: "14 October 2026, 18:37",
        portalUrl,
        logoUrl,
      });
    case "quotation-client":
      return quotationAcceptanceClientEmail({
        clientName: "Sample Client",
        quoteNumber: "R365-2026-0002",
        title: "STARTER BUSINESS WEBSITE",
        total: "R10 000,00",
        acceptedAt: "14 October 2026, 18:37",
        quotationUrl: `${base}/quotation/8f2c1a64-3d9e-4b7a-9c15-6e0d2f4a91b3`,
        banking,
        reference: "R365-2026-0002",
        logoUrl,
      });
    case "quotation-progress":
      return quotationProgressEmail({
        clientName: "Sample Client",
        quoteNumber: "R365-2026-0002",
        title: "STARTER BUSINESS WEBSITE",
        statusLabel: "In progress",
        steps: [
          { label: "Discovery & planning", description: "Confirm scope, milestones and kick-off details.", status: "done" },
          { label: "Design", description: "Wireframes and UI design for review and sign-off.", status: "done" },
          { label: "Development", description: "Build, integrate and test the agreed deliverables.", status: "in_progress" },
          { label: "Testing & QA", description: "Security, responsive and functionality checks.", status: "pending" },
          { label: "Handover", description: "Deployment, documentation and final handover.", status: "pending" },
        ],
        quotationUrl: `${base}/quotation/8f2c1a64-3d9e-4b7a-9c15-6e0d2f4a91b3`,
        banking,
        reference: "R365-2026-0002",
        logoUrl,
      });
    case "client-invite":
      return clientInviteEmail({
        orgName: "Bright Idea Co.",
        email: "naledi@brightideaco.co.za",
        inviteUrl: `${base}/support/register?invite=3d9e4b7a-9c15-6e0d-2f4a-91b3`,
        expiresAt: new Date(Date.now() + 14 * 86_400_000).toISOString(),
        invitedByName: "Rabbit 365",
        logoUrl,
      });
    case "password-reset":
      return passwordResetEmail({
        resetUrl: `${base}/reset-password?portal=admin#access_token=sample&refresh_token=sample&type=recovery`,
        portal: "admin",
        email: "info@rabbit365.co.za",
        logoUrl,
      });
    case "client-registered-team":
      return clientRegisteredTeamEmail({
        orgName: "Bright Idea Co.",
        userName: "Naledi Molefe",
        email: "naledi@brightideaco.co.za",
        registeredAt: new Date().toISOString(),
        portalUrl,
        logoUrl,
      });
    case "funeral-outreach":
      return funeralOutreachEmail({
        businessName: "Makaula's Elegant Funerals",
        observation:
          "your longstanding presence in the funeral services industry and your contribution to the community",
        logoUrl,
      });
    case "support-ticket-client":
      return supportTicketCreatedClient(supportSample(base, logoUrl));
    case "support-ticket-team":
      return supportTicketCreatedTeam(supportSample(base, logoUrl));
    case "support-reply-client":
      return supportTicketReplyClient({
        ...supportSample(base, logoUrl),
        message:
          "Hi Naledi,\n\nThanks for flagging this. We've deployed a fix to the contact form and tested it from both desktop and mobile. Could you confirm it's working on your side?",
      });
    case "support-reply-team":
      return supportTicketReplyTeam({
        ...supportSample(base, logoUrl),
        authorName: "Naledi Molefe",
        message:
          "Thanks for the update  -  I just tested it and the form is sending again. One more thing: can we also add a honeypot field to reduce spam?",
      });
    case "support-status":
      return supportTicketStatusClient({
        ...supportSample(base, logoUrl),
        status: "Resolved",
        message: "This should be sorted now. We'll keep the ticket open for 48 hours in case anything else comes up.",
      });
    case "support-reminder":
      return supportTicketReminderClient({
        ...supportSample(base, logoUrl),
        status: "Waiting on client",
      });
    case "support-auto-closed":
      return supportTicketAutoClosedClient({
        ...supportSample(base, logoUrl),
        status: "Closed",
      });
    default:
      return null;
  }
}

function supportSample(base: string, logoUrl: string) {
  return {
    appUrl: base,
    ticketId: "8f2c1a64-3d9e-4b7a-9c15-6e0d2f4a91b3",
    number: "R365-T-0007",
    subject: "Contact form not sending on the main website",
    orgName: "Bright Idea Co.",
    siteLabel: "Main website",
    siteUrl: "https://brightideaco.co.za",
    category: "Support",
    priority: "High",
    status: "In progress",
    authorName: "Naledi Molefe",
    clientName: "Naledi Molefe",
    message:
      "Hi Rabbit 365,\n\nSince this morning the contact form on our homepage shows a success message but we aren't receiving any emails. We've checked spam and the inbox is fine.\n\nCan you take a look?",
    logoUrl,
  };
}
