import type { SupabaseClient } from "@supabase/supabase-js";

export type BankingDetails = {
  bankName: string;
  accountName: string;
  accountNumber: string;
  accountType: string;
  branchCode: string;
};

export const EMPTY_BANKING: BankingDetails = {
  bankName: "",
  accountName: "",
  accountNumber: "",
  accountType: "",
  branchCode: "",
};

export function isBankingEmpty(banking?: BankingDetails | null): boolean {
  if (!banking) return true;
  return !(
    banking.bankName ||
    banking.accountName ||
    banking.accountNumber ||
    banking.accountType ||
    banking.branchCode
  );
}

/** Read the company banking details (company-wide, single record). */
export async function getBanking(client: SupabaseClient): Promise<BankingDetails> {
  const { data } = await client.from("settings").select("value").eq("key", "banking").maybeSingle();
  const value = (data?.value ?? {}) as Partial<BankingDetails>;
  return { ...EMPTY_BANKING, ...value };
}

/** Merge and persist the company banking details. */
export async function saveBanking(
  client: SupabaseClient,
  banking: Partial<BankingDetails>,
): Promise<BankingDetails> {
  const current = await getBanking(client);
  const next: BankingDetails = { ...current, ...banking };
  await client
    .from("settings")
    .upsert({ key: "banking", value: next, updated_at: new Date().toISOString() }, { onConflict: "key" });
  return next;
}
