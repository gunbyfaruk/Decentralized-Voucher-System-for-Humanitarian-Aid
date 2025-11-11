// tests/donor-vault.test.ts
import { describe, it, expect, beforeEach, vi } from "vitest";
import { Cl, ClarityType, cvToValue, uintCV, stringAsciiCV, someCV, noneCV, listCV, tupleCV, principalCV } from "@stacks/transactions";

interface Campaign {
  donor: string;
  totalBudget: bigint;
  remainingFunds: bigint;
  beneficiaryCount: bigint;
  expiryBlock: bigint;
  category: string;
  status: string;
  createdAt: bigint;
  endedAt: string | null;
  redeemedCount: bigint;
}

interface DonorVaultMock {
  state: {
    contractOwner: string;
    paused: boolean;
    nextCampaignId: bigint;
    platformFeeRate: bigint;
    maxCampaignDuration: bigint;
    minCampaignAmount: bigint;
    campaigns: Map<bigint, Campaign>;
    donorCampaigns: Map<string, bigint[]>;
    categoryWhitelist: Map<string, boolean>;
  };
  blockHeight: bigint;
  caller: string;
  contractAddress: string;
  stxTransfers: Array<{ amount: bigint; from: string; to: string }>;
}

class DonorVaultMockImpl implements DonorVaultMock {
  state = {
    contractOwner: "ST1ADMIN",
    paused: false,
    nextCampaignId: 0n,
    platformFeeRate: 250n,
    maxCampaignDuration: 525600n,
    minCampaignAmount: 1000000n,
    campaigns: new Map(),
    donorCampaigns: new Map(),
    categoryWhitelist: new Map([["food", true], ["medicine", true], ["shelter", true]]),
  };
  blockHeight = 1000n;
  caller = "ST1DONOR";
  contractAddress = "STVAULT";
  stxTransfers: Array<{ amount: bigint; from: string; to: string }> = [];

  reset() {
    this.state = {
      contractOwner: "ST1ADMIN",
      paused: false,
      nextCampaignId: 0n,
      platformFeeRate: 250n,
      maxCampaignDuration: 525600n,
      minCampaignAmount: 1000000n,
      campaigns: new Map(),
      donorCampaigns: new Map(),
      categoryWhitelist: new Map([["food", true], ["medicine", true], ["shelter", true]]),
    };
    this.blockHeight = 1000n;
    this.caller = "ST1DONOR";
    this.stxTransfers = [];
  }

  private assertNotPaused(): { ok: true; value: true } | { ok: false; value: number } {
    return this.state.paused ? { ok: false, value: 116 } : { ok: true, value: true };
  }

  private validateAmount(amount: bigint): boolean {
    return amount > 0n && amount >= this.state.minCampaignAmount;
  }

  private validateExpiry(expiry: bigint): boolean {
    return expiry > this.blockHeight && (expiry - this.blockHeight) <= this.state.maxCampaignDuration;
  }

  private validateBeneficiaryCount(count: bigint): boolean {
    return count > 0n;
  }

  private validateCategory(category: string): boolean {
    return category.length > 0 && category.length <= 50 && (this.state.categoryWhitelist.get(category) ?? false);
  }

  depositAndCreateCampaign(
    totalBudget: bigint,
    beneficiaryCount: bigint,
    expiryBlock: bigint,
    category: string
  ): { ok: true; value: bigint } | { ok: false; value: number } {
    const assertPaused = this.assertNotPaused();
    if (!assertPaused.ok) return assertPaused;

    if (!this.validateAmount(totalBudget)) return { ok: false, value: 104 };
    if (!this.validateBeneficiaryCount(beneficiaryCount)) return { ok: false, value: 106 };
    if (!this.validateExpiry(expiryBlock)) return { ok: false, value: 105 };
    if (!this.validateCategory(category)) return { ok: false, value: 111 };

    const feeAmount = (totalBudget * this.state.platformFeeRate) / 10000n;
    const netBudget = totalBudget - feeAmount;
    const campaignId = this.state.nextCampaignId;
    const donorCampaigns = this.state.donorCampaigns.get(this.caller) ?? [];

    this.stxTransfers.push({ amount: totalBudget, from: this.caller, to: this.contractAddress });

    const campaign: Campaign = {
      donor: this.caller,
      totalBudget: netBudget,
      remainingFunds: netBudget,
      beneficiaryCount,
      expiryBlock,
      category,
      status: "active",
      createdAt: this.blockHeight,
      endedAt: null,
      redeemedCount: 0n,
    };

    this.state.campaigns.set(campaignId, campaign);
    this.state.donorCampaigns.set(this.caller, [...donorCampaigns, campaignId]);
    this.state.nextCampaignId += 1n;

    return { ok: true, value: campaignId };
  }

  extendCampaignExpiry(campaignId: bigint, newExpiry: bigint): { ok: true; value: true } | { ok: false; value: number } {
    const campaign = this.state.campaigns.get(campaignId);
    if (!campaign) return { ok: false, value: 101 };
    if (campaign.donor !== this.caller) return { ok: false, value: 100 };
    if (campaign.status !== "active") return { ok: false, value: 108 };
    if (newExpiry <= campaign.expiryBlock) return { ok: false, value: 105 };
    if (newExpiry - campaign.expiryBlock > 52560n) return { ok: false, value: 105 };

    this.state.campaigns.set(campaignId, { ...campaign, expiryBlock: newExpiry });
    return { ok: true, value: true };
  }

  cancelCampaign(campaignId: bigint): { ok: true; value: true } | { ok: false; value: number } {
    const campaign = this.state.campaigns.get(campaignId);
    if (!campaign) return { ok: false, value: 101 };
    if (campaign.donor !== this.caller) return { ok: false, value: 100 };
    if (campaign.status !== "active") return { ok: false, value: 108 };
    if (this.blockHeight <= campaign.expiryBlock) return { ok: false, value: 107 };
    if (campaign.redeemedCount !== 0n) return { ok: false, value: 107 };

    this.stxTransfers.push({ amount: campaign.remainingFunds, from: this.contractAddress, to: this.caller });
    this.state.campaigns.set(campaignId, { ...campaign, status: "cancelled", remainingFunds: 0n, endedAt: this.blockHeight.toString() });
    return { ok: true, value: true };
  }

  withdrawExcessFunds(campaignId: bigint, amount: bigint): { ok: true; value: true } | { ok: false; value: number } {
    const campaign = this.state.campaigns.get(campaignId);
    if (!campaign) return { ok: false, value: 101 };
    if (campaign.donor !== this.caller) return { ok: false, value: 100 };
    if (!["active", "ended"].includes(campaign.status)) return { ok: false, value: 114 };
    if (this.blockHeight <= campaign.expiryBlock) return { ok: false, value: 110 };

    const perBeneficiary = campaign.remainingFunds / campaign.beneficiaryCount;
    const minReserve = perBeneficiary * campaign.beneficiaryCount;
    if (amount > campaign.remainingFunds - minReserve) return { ok: false, value: 113 };

    this.stxTransfers.push({ amount, from: this.contractAddress, to: this.caller });
    this.state.campaigns.set(campaignId, { ...campaign, remainingFunds: campaign.remainingFunds - amount });
    return { ok: true, value: true };
  }

  endCampaignManually(campaignId: bigint): { ok: true; value: true } | { ok: false; value: number } {
    const campaign = this.state.campaigns.get(campaignId);
    if (!campaign) return { ok: false, value: 101 };
    if (campaign.donor !== this.caller) return { ok: false, value: 100 };
    if (campaign.status !== "active") return { ok: false, value: 108 };

    this.state.campaigns.set(campaignId, { ...campaign, status: "ended", endedAt: this.blockHeight.toString() });
    return { ok: true, value: true };
  }

  releaseFundsToMerchant(
    campaignId: bigint,
    amount: bigint,
    merchant: string
  ): { ok: true; value: true } | { ok: false; value: number } {
    const campaign = this.state.campaigns.get(campaignId);
    if (!campaign) return { ok: false, value: 101 };
    if (campaign.status !== "active") return { ok: false, value: 108 };
    if (this.blockHeight > campaign.expiryBlock) return { ok: false, value: 102 };
    if (campaign.remainingFunds < amount) return { ok: false, value: 103 };
    if (amount === 0n) return { ok: false, value: 112 };

    this.stxTransfers.push({ amount, from: this.contractAddress, to: merchant });
    this.state.campaigns.set(campaignId, {
      ...campaign,
      remainingFunds: campaign.remainingFunds - amount,
      redeemedCount: campaign.redeemedCount + 1n,
    });
    return { ok: true, value: true };
  }

  setPaused(newState: boolean): { ok: true; value: true } | { ok: false; value: number } {
    if (this.caller !== this.state.contractOwner) return { ok: false, value: 115 };
    this.state.paused = newState;
    return { ok: true, value: true };
  }

  setPlatformFee(newRate: bigint): { ok: true; value: true } | { ok: false; value: number } {
    if (this.caller !== this.state.contractOwner) return { ok: false, value: 115 };
    if (newRate > 1000n) return { ok: false, value: 104 };
    this.state.platformFeeRate = newRate;
    return { ok: true, value: true };
  }

  setMinCampaignAmount(amount: bigint): { ok: true; value: true } | { ok: false; value: number } {
    if (this.caller !== this.state.contractOwner) return { ok: false, value: 115 };
    if (amount === 0n) return { ok: false, value: 112 };
    this.state.minCampaignAmount = amount;
    return { ok: true, value: true };
  }

  addCategory(category: string): { ok: true; value: true } | { ok: false; value: number } {
    if (this.caller !== this.state.contractOwner) return { ok: false, value: 115 };
    if (category.length === 0) return { ok: false, value: 111 };
    this.state.categoryWhitelist.set(category, true);
    return { ok: true, value: true };
  }

  removeCategory(category: string): { ok: true; value: true } {
    if (this.caller !== this.state.contractOwner) return { ok: false, value: 115 };
    this.state.categoryWhitelist.delete(category);
    return { ok: true, value: true };
  }

  getCampaign(campaignId: bigint): Campaign | null {
    return this.state.campaigns.get(campaignId) ?? null;
  }

  getDonorCampaigns(donor: string): bigint[] {
    return this.state.donorCampaigns.get(donor) ?? [];
  }

  isCategoryAllowed(category: string): boolean {
    return this.state.categoryWhitelist.get(category) ?? false;
  }

  getContractBalance(): bigint {
    return 0n;
  }

  isPaused(): boolean {
    return this.state.paused;
  }
}

describe("DonorVault Contract", () => {
  let vault: DonorVaultMockImpl;

  beforeEach(() => {
    vault = new DonorVaultMockImpl();
    vault.reset();
  });

  it("should reject campaign with insufficient budget", () => {
    const result = vault.depositAndCreateCampaign(500000n, 5n, 1500n, "food");
    expect(result.ok).toBe(false);
    expect(result.value).toBe(104);
  });

  it("should reject campaign with invalid expiry", () => {
    const result = vault.depositAndCreateCampaign(10000000n, 10n, 1000n, "food");
    expect(result.ok).toBe(false);
    expect(result.value).toBe(105);
  });

  it("should reject campaign with invalid category", () => {
    const result = vault.depositAndCreateCampaign(10000000n, 10n, 2000n, "invalid");
    expect(result.ok).toBe(false);
    expect(result.value).toBe(111);
  });

  it("should allow admin to pause and unpause", () => {
    vault.caller = "ST1ADMIN";
    let result = vault.setPaused(true);
    expect(result.ok).toBe(true);
    expect(vault.isPaused()).toBe(true);

    result = vault.setPaused(false);
    expect(result.ok).toBe(true);
    expect(vault.isPaused()).toBe(false);
  });

  it("should reject non-admin pause attempt", () => {
    const result = vault.setPaused(true);
    expect(result.ok).toBe(false);
    expect(result.value).toBe(115);
  });

  it("should reject campaign creation when paused", () => {
    vault.caller = "ST1ADMIN";
    vault.setPaused(true);
    vault.caller = "ST1DONOR";
    const result = vault.depositAndCreateCampaign(10000000n, 10n, 2000n, "food");
    expect(result.ok).toBe(false);
    expect(result.value).toBe(116);
  });

  it("should extend campaign expiry successfully", () => {
    vault.depositAndCreateCampaign(10000000n, 10n, 2000n, "food");
    const result = vault.extendCampaignExpiry(0n, 2500n);
    expect(result.ok).toBe(true);
    const campaign = vault.getCampaign(0n);
    expect(campaign?.expiryBlock).toBe(2500n);
  });

  it("should reject expiry extension by non-donor", () => {
    vault.depositAndCreateCampaign(10000000n, 10n, 2000n, "food");
    vault.caller = "ST2HACKER";
    const result = vault.extendCampaignExpiry(0n, 2500n);
    expect(result.ok).toBe(false);
    expect(result.value).toBe(100);
  });

  it("should reject cancel of active campaign", () => {
    vault.depositAndCreateCampaign(10000000n, 10n, 2000n, "food");
    const result = vault.cancelCampaign(0n);
    expect(result.ok).toBe(false);
    expect(result.value).toBe(107);
  });

  it("should withdraw excess funds after expiry", () => {
    vault.depositAndCreateCampaign(10000000n, 10n, 1100n, "food");
    vault.blockHeight = 1200n;
    vault.releaseFundsToMerchant(0n, 1000000n, "ST1MERCHANT");
    const perBeneficiary = 8975000n / 10n;
    const excess = 8975000n - (perBeneficiary * 10n);
    const result = vault.withdrawExcessFunds(0n, excess);
    expect(result.ok).toBe(true);
  });

  it("should reject excess withdrawal beyond limit", () => {
    vault.depositAndCreateCampaign(10000000n, 10n, 1100n, "food");
    vault.blockHeight = 1200n;
    const result = vault.withdrawExcessFunds(0n, 10000000n);
    expect(result.ok).toBe(false);
    expect(result.value).toBe(113);
  });

  it("should end campaign manually", () => {
    vault.depositAndCreateCampaign(10000000n, 10n, 2000n, "food");
    const result = vault.endCampaignManually(0n);
    expect(result.ok).toBe(true);
    const campaign = vault.getCampaign(0n);
    expect(campaign?.status).toBe("ended");
  });

  it("should reject release after expiry", () => {
    vault.depositAndCreateCampaign(10000000n, 10n, 1100n, "food");
    vault.blockHeight = 1200n;
    const result = vault.releaseFundsToMerchant(0n, 500000n, "ST1MERCHANT");
    expect(result.ok).toBe(false);
    expect(result.value).toBe(102);
  });

  it("should update platform fee", () => {
    vault.caller = "ST1ADMIN";
    const result = vault.setPlatformFee(500n);
    expect(result.ok).toBe(true);
    expect(vault.state.platformFeeRate).toBe(500n);
  });

  it("should add and remove category", () => {
    vault.caller = "ST1ADMIN";
    let result = vault.addCategory("education");
    expect(result.ok).toBe(true);
    expect(vault.isCategoryAllowed("education")).toBe(true);

    result = vault.removeCategory("education");
    expect(result.ok).toBe(true);
    expect(vault.isCategoryAllowed("education")).toBe(false);
  });

  it("should track donor campaigns", () => {
    vault.depositAndCreateCampaign(10000000n, 10n, 2000n, "food");
    vault.depositAndCreateCampaign(20000000n, 20n, 3000n, "medicine");
    const campaigns = vault.getDonorCampaigns("ST1DONOR");
    expect(campaigns).toEqual([0n, 1n]);
  });

  it("should handle multiple donors", () => {
    vault.depositAndCreateCampaign(10000000n, 10n, 2000n, "food");
    vault.caller = "ST2DONOR";
    vault.depositAndCreateCampaign(15000000n, 15n, 2500n, "shelter");
    expect(vault.getDonorCampaigns("ST1DONOR")).toEqual([0n]);
    expect(vault.getDonorCampaigns("ST2DONOR")).toEqual([1n]);
  });

  it("should enforce minimum campaign amount", () => {
    vault.caller = "ST1ADMIN";
    vault.setMinCampaignAmount(5000000n);
    vault.caller = "ST1DONOR";
    const result = vault.depositAndCreateCampaign(4000000n, 10n, 2000n, "food");
    expect(result.ok).toBe(false);
    expect(result.value).toBe(104);
  });

  it("should calculate fee correctly", () => {
    vault.caller = "ST1ADMIN";
    vault.setPlatformFee(1000n);
    vault.caller = "ST1DONOR";
    vault.depositAndCreateCampaign(10000000n, 10n, 2000n, "food");
    const campaign = vault.getCampaign(0n);
    expect(campaign?.totalBudget).toBe(9000000n);
  });

  it("should prevent zero amount release", () => {
    vault.depositAndCreateCampaign(10000000n, 10n, 2000n, "food");
    const result = vault.releaseFundsToMerchant(0n, 0n, "ST1MERCHANT");
    expect(result.ok).toBe(false);
    expect(result.value).toBe(112);
  });

  it("should increment campaign ID correctly", () => {
    vault.depositAndCreateCampaign(10000000n, 10n, 2000n, "food");
    vault.depositAndCreateCampaign(20000000n, 20n, 3000n, "medicine");
    expect(vault.state.nextCampaignId).toBe(2n);
  });
});