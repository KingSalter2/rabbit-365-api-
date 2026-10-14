import {
  brandLogoUrl,
  leadConfirmationEmail,
  leadNotificationEmail,
  quotationAcceptanceClientEmail,
  quotationAcceptedTeamEmail,
  type EmailContent,
} from "./emails";

export type SampleEmailKey = "lead" | "lead-client" | "quotation-team" | "quotation-client";

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
];

/** Render a template with representative sample data for previewing. */
export function renderSampleEmail(key: string, baseUrl: string): EmailContent | null {
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
        logoUrl,
      });
    default:
      return null;
  }
}
