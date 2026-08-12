/**
 * Double-entry ledger.
 *
 * Every movement of value in CryptoQu is a transaction of two or more postings
 * that must sum to zero within each currency it touches. A payment crosses
 * currencies, so it is recorded as two balanced halves joined by a clearing
 * account: the stablecoin side nets to zero, the rupiah side nets to zero, and
 * the residual sitting in the clearing account is the FX position the treasury
 * desk is carrying.
 *
 * Amounts are bigint minor units. No floating point ever touches a balance.
 */

export type Currency = "IDR" | "USDC" | "USDT" | "IDRX" | "PYUSD" | "EURC" | "XSGD";

export const CURRENCY_DECIMALS: Record<Currency, number> = {
  IDR: 0,
  USDC: 6,
  USDT: 6,
  IDRX: 2,
  PYUSD: 6,
  EURC: 6,
  XSGD: 6,
};

export type AccountKind =
  | "asset" // things CryptoQu holds: vaults, fiat float
  | "liability" // what CryptoQu owes: merchant payables
  | "equity"
  | "revenue"
  | "expense"
  | "external" // counterparties outside the books: payers, acquirers
  | "clearing"; // transient FX / conversion positions

export interface Account {
  id: string;
  name: string;
  kind: AccountKind;
  currency: Currency;
}

export interface Posting {
  accountId: string;
  currency: Currency;
  /** Positive is a debit, negative is a credit. */
  amount: bigint;
}

export interface LedgerTransaction {
  id: string;
  /** Business object this transaction belongs to, e.g. a payment intent id. */
  reference: string;
  description: string;
  createdAt: number;
  postings: Posting[];
}

export class LedgerError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LedgerError";
  }
}

export class Ledger {
  private readonly accounts = new Map<string, Account>();
  private readonly transactions: LedgerTransaction[] = [];
  private readonly balances = new Map<string, bigint>();

  openAccount(account: Account): Account {
    if (this.accounts.has(account.id)) return this.accounts.get(account.id)!;
    this.accounts.set(account.id, account);
    this.balances.set(this.key(account.id, account.currency), 0n);
    return account;
  }

  getAccount(id: string): Account | undefined {
    return this.accounts.get(id);
  }

  listAccounts(): Account[] {
    return [...this.accounts.values()];
  }

  /**
   * Records a transaction. Rejects anything that does not balance, references
   * an unknown account, or posts a currency the account does not hold — a
   * ledger that accepts an unbalanced entry is worse than no ledger.
   */
  post(input: Omit<LedgerTransaction, "createdAt"> & { createdAt?: number }): LedgerTransaction {
    if (input.postings.length < 2) {
      throw new LedgerError("a transaction needs at least two postings");
    }

    const sums = new Map<Currency, bigint>();
    for (const posting of input.postings) {
      const account = this.accounts.get(posting.accountId);
      if (!account) throw new LedgerError(`unknown account "${posting.accountId}"`);
      if (account.currency !== posting.currency) {
        throw new LedgerError(
          `account "${account.id}" holds ${account.currency}, not ${posting.currency}`,
        );
      }
      if (posting.amount === 0n) {
        throw new LedgerError(`zero-value posting on "${account.id}"`);
      }
      sums.set(posting.currency, (sums.get(posting.currency) ?? 0n) + posting.amount);
    }

    for (const [currency, sum] of sums) {
      if (sum !== 0n) {
        throw new LedgerError(`transaction does not balance in ${currency}: off by ${sum}`);
      }
    }

    const transaction: LedgerTransaction = {
      id: input.id,
      reference: input.reference,
      description: input.description,
      createdAt: input.createdAt ?? Date.now(),
      postings: input.postings,
    };

    for (const posting of transaction.postings) {
      const key = this.key(posting.accountId, posting.currency);
      this.balances.set(key, (this.balances.get(key) ?? 0n) + posting.amount);
    }
    this.transactions.push(transaction);
    return transaction;
  }

  balance(accountId: string, currency: Currency): bigint {
    return this.balances.get(this.key(accountId, currency)) ?? 0n;
  }

  /** All transactions touching a business reference, oldest first. */
  historyFor(reference: string): LedgerTransaction[] {
    return this.transactions.filter((transaction) => transaction.reference === reference);
  }

  listTransactions(limit = 50): LedgerTransaction[] {
    return this.transactions.slice(-limit).reverse();
  }

  /**
   * Sum of every balance, per currency. A healthy ledger reports zero for all
   * of them; anything else means a posting slipped past validation.
   */
  trialBalance(): Record<string, string> {
    const totals = new Map<Currency, bigint>();
    for (const account of this.accounts.values()) {
      const value = this.balance(account.id, account.currency);
      totals.set(account.currency, (totals.get(account.currency) ?? 0n) + value);
    }
    return Object.fromEntries([...totals].map(([currency, total]) => [currency, total.toString()]));
  }

  isBalanced(): boolean {
    return Object.values(this.trialBalance()).every((total) => total === "0");
  }

  private key(accountId: string, currency: Currency): string {
    return `${accountId}::${currency}`;
  }
}

/** Converts a human amount to minor units without floating point drift. */
export function toMinor(amount: number, currency: Currency): bigint {
  const decimals = CURRENCY_DECIMALS[currency];
  const [whole, fraction = ""] = amount.toFixed(decimals).split(".");
  const negative = whole.startsWith("-");
  const digits = `${whole.replace("-", "")}${fraction.padEnd(decimals, "0")}`;
  const value = BigInt(digits || "0");
  return negative ? -value : value;
}

/** Renders minor units back to a decimal string. */
export function fromMinor(amount: bigint, currency: Currency): string {
  const decimals = CURRENCY_DECIMALS[currency];
  const negative = amount < 0n;
  const digits = (negative ? -amount : amount).toString().padStart(decimals + 1, "0");
  const whole = digits.slice(0, digits.length - decimals);
  const fraction = decimals > 0 ? `.${digits.slice(digits.length - decimals)}` : "";
  return `${negative ? "-" : ""}${whole}${fraction}`;
}

/** Well-known account ids so callers do not hand-build strings. */
export const ACCOUNTS = {
  payerExternal: (currency: Currency) => `external:payer:${currency}`,
  vault: (chain: string, currency: Currency) => `asset:vault:${chain}:${currency}`,
  /** One per currency: an account holds exactly one, and a conversion touches two. */
  conversionClearing: (venueId: string, currency: Currency) =>
    `clearing:conversion:${venueId}:${currency}`,
  fiatFloat: "asset:fiat:idr-float",
  merchantPayable: (merchantId: string) => `liability:merchant:${merchantId}`,
  acquirerExternal: "external:acquirer:idr",
  platformRevenue: "revenue:platform-fee",
  railExpense: "expense:settlement-rail",
} as const;
