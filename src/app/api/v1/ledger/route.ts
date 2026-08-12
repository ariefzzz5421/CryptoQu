import { NextResponse } from "next/server";

import { handle } from "@/server/http";
import { fromMinor } from "@/server/ledger";
import { getStore } from "@/server/store";

export const dynamic = "force-dynamic";

/**
 * The books. Exposed because a payment processor that cannot show a balanced
 * ledger on demand is asking to be taken on trust.
 */
export async function GET(request: Request) {
  return handle(request, { rateLimit: 120 }, () => {
    const { ledger } = getStore();
    const reference = new URL(request.url).searchParams.get("reference");

    const transactions = reference ? ledger.historyFor(reference) : ledger.listTransactions(50);

    return NextResponse.json({
      balanced: ledger.isBalanced(),
      trialBalance: ledger.trialBalance(),
      accounts: ledger
        .listAccounts()
        .map((account) => ({
          ...account,
          balance: fromMinor(ledger.balance(account.id, account.currency), account.currency),
        }))
        .filter((account) => account.balance !== "0" && account.balance !== "0.00"),
      transactions: transactions.map((transaction) => ({
        id: transaction.id,
        reference: transaction.reference,
        description: transaction.description,
        createdAt: new Date(transaction.createdAt).toISOString(),
        postings: transaction.postings.map((posting) => ({
          account: posting.accountId,
          currency: posting.currency,
          amount: fromMinor(posting.amount, posting.currency),
          direction: posting.amount > 0n ? "debit" : "credit",
        })),
      })),
    });
  });
}
