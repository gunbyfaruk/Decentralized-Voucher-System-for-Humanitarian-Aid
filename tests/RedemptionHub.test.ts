import { describe, it, expect, beforeEach } from "vitest";
import { cvToValue, stringUtf8CV, uintCV, principalCV, BooleanCV } from "@stacks/transactions";

const ERR_NOT_AUTHORIZED = 100;
const ERR_INVALID_VOUCHER = 101;
const ERR_EXPIRED = 102;
const ERR_MERCHANT_NOT_APPROVED = 103;
const ERR_INVALID_AMOUNT = 104;
const ERR_ALREADY_REDEEMED = 105;
const ERR_INVALID_CAMPAIGN = 106;
const ERR_INSUFFICIENT_FUNDS = 107;
const ERR_INVALID_BENEFICIARY = 108;
const ERR_INVALID_MERCHANT = 109;

interface Redemption {
  beneficiary: string;
  merchant: string;
  amount: number;
  timestamp: number;
  campaignId: number;
  category: string;
  redeemed: boolean;
}

interface CampaignStats {
  totalAmount: number;
  redemptionCount: number;
}

interface VoucherDetails {
  amount: number;
  expiry: number;
  campaignId: number;
  category: string;
}

interface Campaign {
  availableFunds: number;
}

interface Result<T> {
  ok: boolean;
  value: T;
}

class RedemptionHubMock {
  state: {
    contractOwner: string;
    redemptionFee: number;
    maxRedemptionsPerBlock: number;
    totalRedemptions: number;
    redemptions: Map<number, Redemption>;
    redemptionStats: Map<number, CampaignStats>;
  } = {
    contractOwner: "ST1TEST",
    redemptionFee: 100,
    maxRedemptionsPerBlock: 1000,
    totalRedemptions: 0,
    redemptions: new Map(),
    redemptionStats: new Map(),
  };
  blockHeight: number = 100;
  caller: string = "ST1TEST";
  voucherIssuer: {
    getVoucherDetails: (voucherId: number) => Result<VoucherDetails>;
    burnVoucher: (voucherId: number) => Result<boolean>;
  };
  beneficiaryRegistry: {
    isEligible: (beneficiary: string) => boolean;
  };
  merchantRegistry: {
    isApproved: (merchant: string, category: string) => boolean;
  };
  donorVault: {
    getCampaign: (campaignId: number) => Result<Campaign>;
    transferFunds: (merchant: string, amount: number) => Result<boolean>;
  };
  stxTransfers: Array<{ amount: number; from: string; to: string }> = [];

  constructor() {
    this.reset();
    this.voucherIssuer = {
      getVoucherDetails: () => ({
        ok: true,
        value: { amount: 1000, expiry: this.blockHeight + 100, campaignId: 1, category: "food" },
      }),
      burnVoucher: () => ({ ok: true, value: true }),
    };
    this.beneficiaryRegistry = {
      isEligible: () => true,
    };
    this.merchantRegistry = {
      isApproved: () => true,
    };
    this.donorVault = {
      getCampaign: () => ({ ok: true, value: { availableFunds: 10000 } }),
      transferFunds: (merchant: string, amount: number) => {
        this.stxTransfers.push({ amount, from: "vault", to: merchant });
        return { ok: true, value: true };
      },
    };
  }

  reset() {
    this.state = {
      contractOwner: "ST1TEST",
      redemptionFee: 100,
      maxRedemptionsPerBlock: 1000,
      totalRedemptions: 0,
      redemptions: new Map(),
      redemptionStats: new Map(),
    };
    this.blockHeight = 100;
    this.caller = "ST1TEST";
    this.stxTransfers = [];
  }

  getRedemption(voucherId: number): Redemption | null {
    return this.state.redemptions.get(voucherId) || null;
  }

  getCampaignStats(campaignId: number): CampaignStats | null {
    return this.state.redemptionStats.get(campaignId) || null;
  }

  getTotalRedemptions(): Result<number> {
    return { ok: true, value: this.state.totalRedemptions };
  }

  getRedemptionFee(): Result<number> {
    return { ok: true, value: this.state.redemptionFee };
  }

  setRedemptionFee(newFee: number): Result<boolean> {
    if (this.caller !== this.state.contractOwner) return { ok: false, value: false };
    this.state.redemptionFee = newFee;
    return { ok: true, value: true };
  }

  setMaxRedemptionsPerBlock(newMax: number): Result<boolean> {
    if (this.caller !== this.state.contractOwner) return { ok: false, value: false };
    if (newMax <= 0) return { ok: false, value: false };
    this.state.maxRedemptionsPerBlock = newMax;
    return { ok: true, value: true };
  }

  redeemVoucher(voucherId: number, merchant: string): Result<boolean> {
    const redemption = this.state.redemptions.get(voucherId);
    if (!redemption) return { ok: false, value: false };
    if (redemption.redeemed) return { ok: false, value: false };

    const voucherDetailsResult = this.voucherIssuer.getVoucherDetails(voucherId);
    if (!voucherDetailsResult.ok) return { ok: false, value: false };
    const { amount, expiry, campaignId, category } = voucherDetailsResult.value;

    if (expiry <= this.blockHeight) return { ok: false, value: false };
    if (amount <= 0) return { ok: false, value: false };
    if (!this.beneficiaryRegistry.isEligible(this.caller)) return { ok: false, value: false };
    if (!this.merchantRegistry.isApproved(merchant, category)) return { ok: false, value: false };

    const campaignResult = this.donorVault.getCampaign(campaignId);
    if (!campaignResult.ok) return { ok: false, value: false };
    if (campaignResult.value.availableFunds < amount) return { ok: false, value: false };

    if (this.state.totalRedemptions >= this.state.maxRedemptionsPerBlock) {
      return { ok: false, value: false };
    }

    const burnResult = this.voucherIssuer.burnVoucher(voucherId);
    if (!burnResult.ok) return { ok: false, value: false };

    this.stxTransfers.push({ amount: this.state.redemptionFee, from: this.caller, to: this.state.contractOwner });
    const transferResult = this.donorVault.transferFunds(merchant, amount);
    if (!transferResult.ok) return { ok: false, value: false };

    this.state.redemptions.set(voucherId, {
      beneficiary: this.caller,
      merchant,
      amount,
      timestamp: this.blockHeight,
      campaignId,
      category,
      redeemed: true,
    });

    const stats = this.state.redemptionStats.get(campaignId) || { totalAmount: 0, redemptionCount: 0 };
    this.state.redemptionStats.set(campaignId, {
      totalAmount: stats.totalAmount + amount,
      redemptionCount: stats.redemptionCount + 1,
    });

    this.state.totalRedemptions += 1;
    return { ok: true, value: true };
  }

  claimPayment(voucherId: number): Result<boolean> {
    const redemption = this.state.redemptions.get(voucherId);
    if (!redemption) return { ok: false, value: false };
    if (redemption.merchant !== this.caller) return { ok: false, value: false };
    if (!redemption.redeemed) return { ok: false, value: false };
    return { ok: true, value: true };
  }
}

describe("RedemptionHub", () => {
  let contract: RedemptionHubMock;

  beforeEach(() => {
    contract = new RedemptionHubMock();
    contract.reset();
  });

  it("redeems voucher successfully", () => {
    contract.state.redemptions.set(1, {
      beneficiary: "ST1TEST",
      merchant: "ST2MERCHANT",
      amount: 1000,
      timestamp: 0,
      campaignId: 1,
      category: "food",
      redeemed: false,
    });
    const result = contract.redeemVoucher(1, "ST2MERCHANT");
    expect(result.ok).toBe(true);
    expect(result.value).toBe(true);

    const redemption = contract.getRedemption(1);
    expect(redemption?.redeemed).toBe(true);
    expect(redemption?.beneficiary).toBe("ST1TEST");
    expect(redemption?.merchant).toBe("ST2MERCHANT");
    expect(redemption?.amount).toBe(1000);
    expect(redemption?.timestamp).toBe(100);
    expect(redemption?.campaignId).toBe(1);
    expect(redemption?.category).toBe("food");

    const stats = contract.getCampaignStats(1);
    expect(stats?.totalAmount).toBe(1000);
    expect(stats?.redemptionCount).toBe(1);

    expect(contract.stxTransfers).toEqual([
      { amount: 100, from: "ST1TEST", to: "ST1TEST" },
      { amount: 1000, from: "vault", to: "ST2MERCHANT" },
    ]);
    expect(contract.getTotalRedemptions().value).toBe(1);
  });

  it("rejects redemption for invalid voucher", () => {
    const result = contract.redeemVoucher(999, "ST2MERCHANT");
    expect(result.ok).toBe(false);
    expect(result.value).toBe(false);
  });

  it("rejects redemption for already redeemed voucher", () => {
    contract.state.redemptions.set(1, {
      beneficiary: "ST1TEST",
      merchant: "ST2MERCHANT",
      amount: 1000,
      timestamp: 0,
      campaignId: 1,
      category: "food",
      redeemed: true,
    });
    const result = contract.redeemVoucher(1, "ST2MERCHANT");
    expect(result.ok).toBe(false);
    expect(result.value).toBe(false);
  });

  it("rejects redemption for expired voucher", () => {
    contract.state.redemptions.set(1, {
      beneficiary: "ST1TEST",
      merchant: "ST2MERCHANT",
      amount: 1000,
      timestamp: 0,
      campaignId: 1,
      category: "food",
      redeemed: false,
    });
    contract.voucherIssuer.getVoucherDetails = () => ({
      ok: true,
      value: { amount: 1000, expiry: contract.blockHeight - 1, campaignId: 1, category: "food" },
    });
    const result = contract.redeemVoucher(1, "ST2MERCHANT");
    expect(result.ok).toBe(false);
    expect(result.value).toBe(false);
  });

  it("rejects redemption for invalid beneficiary", () => {
    contract.state.redemptions.set(1, {
      beneficiary: "ST1TEST",
      merchant: "ST2MERCHANT",
      amount: 1000,
      timestamp: 0,
      campaignId: 1,
      category: "food",
      redeemed: false,
    });
    contract.beneficiaryRegistry.isEligible = () => false;
    const result = contract.redeemVoucher(1, "ST2MERCHANT");
    expect(result.ok).toBe(false);
    expect(result.value).toBe(false);
  });

  it("rejects redemption for unapproved merchant", () => {
    contract.state.redemptions.set(1, {
      beneficiary: "ST1TEST",
      merchant: "ST2MERCHANT",
      amount: 1000,
      timestamp: 0,
      campaignId: 1,
      category: "food",
      redeemed: false,
    });
    contract.merchantRegistry.isApproved = () => false;
    const result = contract.redeemVoucher(1, "ST2MERCHANT");
    expect(result.ok).toBe(false);
    expect(result.value).toBe(false);
  });

  it("rejects redemption for invalid campaign", () => {
    contract.state.redemptions.set(1, {
      beneficiary: "ST1TEST",
      merchant: "ST2MERCHANT",
      amount: 1000,
      timestamp: 0,
      campaignId: 999,
      category: "food",
      redeemed: false,
    });
    contract.donorVault.getCampaign = () => ({ ok: false, value: {} as Campaign });
    const result = contract.redeemVoucher(1, "ST2MERCHANT");
    expect(result.ok).toBe(false);
    expect(result.value).toBe(false);
  });

  it("rejects redemption for insufficient funds", () => {
    contract.state.redemptions.set(1, {
      beneficiary: "ST1TEST",
      merchant: "ST2MERCHANT",
      amount: 1000,
      timestamp: 0,
      campaignId: 1,
      category: "food",
      redeemed: false,
    });
    contract.donorVault.getCampaign = () => ({ ok: true, value: { availableFunds: 500 } });
    const result = contract.redeemVoucher(1, "ST2MERCHANT");
    expect(result.ok).toBe(false);
    expect(result.value).toBe(false);
  });

  it("rejects redemption when max redemptions per block exceeded", () => {
    contract.state.redemptions.set(1, {
      beneficiary: "ST1TEST",
      merchant: "ST2MERCHANT",
      amount: 1000,
      timestamp: 0,
      campaignId: 1,
      category: "food",
      redeemed: false,
    });
    contract.state.totalRedemptions = 1000;
    const result = contract.redeemVoucher(1, "ST2MERCHANT");
    expect(result.ok).toBe(false);
    expect(result.value).toBe(false);
  });

  it("sets redemption fee successfully", () => {
    const result = contract.setRedemptionFee(200);
    expect(result.ok).toBe(true);
    expect(result.value).toBe(true);
    expect(contract.state.redemptionFee).toBe(200);
  });

  it("rejects redemption fee change by non-owner", () => {
    contract.caller = "ST2FAKE";
    const result = contract.setRedemptionFee(200);
    expect(result.ok).toBe(false);
    expect(result.value).toBe(false);
  });

  it("sets max redemptions per block successfully", () => {
    const result = contract.setMaxRedemptionsPerBlock(500);
    expect(result.ok).toBe(true);
    expect(result.value).toBe(true);
    expect(contract.state.maxRedemptionsPerBlock).toBe(500);
  });

  it("rejects max redemptions change by non-owner", () => {
    contract.caller = "ST2FAKE";
    const result = contract.setMaxRedemptionsPerBlock(500);
    expect(result.ok).toBe(false);
    expect(result.value).toBe(false);
  });

  it("rejects max redemptions change with invalid amount", () => {
    const result = contract.setMaxRedemptionsPerBlock(0);
    expect(result.ok).toBe(false);
    expect(result.value).toBe(false);
  });

  it("claims payment successfully", () => {
    contract.state.redemptions.set(1, {
      beneficiary: "ST1TEST",
      merchant: "ST2MERCHANT",
      amount: 1000,
      timestamp: 100,
      campaignId: 1,
      category: "food",
      redeemed: true,
    });
    contract.caller = "ST2MERCHANT";
    const result = contract.claimPayment(1);
    expect(result.ok).toBe(true);
    expect(result.value).toBe(true);
  });

  it("rejects claim payment by non-merchant", () => {
    contract.state.redemptions.set(1, {
      beneficiary: "ST1TEST",
      merchant: "ST2MERCHANT",
      amount: 1000,
      timestamp: 100,
      campaignId: 1,
      category: "food",
      redeemed: true,
    });
    contract.caller = "ST3FAKE";
    const result = contract.claimPayment(1);
    expect(result.ok).toBe(false);
    expect(result.value).toBe(false);
  });

  it("rejects claim payment for non-redeemed voucher", () => {
    contract.state.redemptions.set(1, {
      beneficiary: "ST1TEST",
      merchant: "ST2MERCHANT",
      amount: 1000,
      timestamp: 0,
      campaignId: 1,
      category: "food",
      redeemed: false,
    });
    contract.caller = "ST2MERCHANT";
    const result = contract.claimPayment(1);
    expect(result.ok).toBe(false);
    expect(result.value).toBe(false);
  });
});