# AidVault: Decentralized Voucher System for Humanitarian Aid

## Overview

**AidVault** is a Web3 project built on the Stacks blockchain using Clarity smart contracts. It implements a transparent, fraud-resistant voucher system for distributing humanitarian aid. Donors can lock funds in smart contracts to issue redeemable vouchers (as non-fungible tokens), which verified beneficiaries can redeem for essential goods or services from approved merchants. All transactions are on-chain, ensuring immutability, auditability, and direct peer-to-peer value transfer without intermediaries.

This solves real-world problems in aid distribution:
- **Fraud and Mismanagement**: Traditional aid systems lose 20-30% to corruption (per UN reports). AidVault uses smart contracts to enforce rules, preventing unauthorized redemptions.
- **Inefficiency and Delays**: Paper-based or centralized systems cause bottlenecks. Blockchain enables instant, borderless issuance and redemption.
- **Lack of Transparency**: Donors and auditors can track every voucher from issuance to redemption in real-time.
- **Inclusion for Underserved**: Targets disaster relief, refugee aid, or conditional cash transfers in regions with poor banking infrastructure.

The system uses STX (Stacks' native token) for funding and supports SIP-009 NFTs for vouchers, ensuring composability with other Stacks ecosystem tools.

## Key Features
- **Secure Issuance**: Donors specify voucher amounts, expiration, and beneficiary lists.
- **Identity Verification**: Zero-knowledge proofs or oracle-based KYC for beneficiary registration (integrates with external identity providers).
- **Conditional Redemption**: Vouchers redeemable only for approved categories (e.g., food, medicine) at whitelisted merchants.
- **Audit Trails**: Public queries for impact reporting.
- **Governance**: Community-driven updates via on-chain voting.

## Architecture

AidVault consists of **6 core Clarity smart contracts**, deployed on the Stacks mainnet or testnet. They interact via cross-contract calls for modularity and security. Funds flow: Donor → Vault → Voucher → Redemption → Merchant.

### Smart Contracts Overview

1. **BeneficiaryRegistry** (`beneficiary-registry.clar`)
   - **Purpose**: Manages beneficiary registration and verification to prevent duplicate or fraudulent claims.
   - **Key Functions**:
     - `register-beneficiary`: Adds a beneficiary with traits (e.g., ID hash, eligibility category) using principal-based access.
     - `verify-beneficiary`: Oracle-integrated check for eligibility (e.g., via external API call simulated in Clarity).
     - `is-eligible`: Read-only function to check status.
   - **Storage**: Maps of beneficiary principals to traits and verification status.
   - **Security**: Only admins (via multisig) can approve registrations; uses Clarity's `asserts!` for validation.

2. **DonorVault** (`donor-vault.clar`)
   - **Purpose**: Securely holds donor funds and initiates voucher campaigns.
   - **Key Functions**:
     - `deposit-funds`: Transfers STX from donor to the vault.
     - `start-campaign`: Defines campaign params (total budget, beneficiary count, expiration) and triggers issuance.
     - `withdraw-excess`: Refunds unused funds post-expiration.
   - **Storage**: Campaign maps with donor principal, budget, and status.
   - **Security**: Time-locked withdrawals; integrates with Clarity's `ft-transfer?` for token handling.

3. **VoucherIssuer** (`voucher-issuer.clar`)
   - **Purpose**: Mints SIP-009 compliant NFT vouchers tied to specific beneficiaries and amounts.
   - **Key Functions**:
     - `mint-voucher`: Called by DonorVault; creates NFT with metadata (amount, expiry, category).
     - `burn-voucher`: Invalidates unredeemed vouchers at expiry.
     - `get-voucher-details`: Queries NFT traits.
   - **Storage**: Inherits SIP-009 traits; maps token IDs to redemption status.
   - **Security**: Only mintable by DonorVault; uses `nft-mint?` with principal restrictions.

4. **MerchantRegistry** (`merchant-registry.clar`)
   - **Purpose**: Whitelists merchants and categorizes acceptable redemptions (e.g., grocery vs. medical).
   - **Key Functions**:
     - `register-merchant`: Admin-only addition with category approvals.
     - `is-approved`: Checks merchant eligibility for a voucher category.
     - `update-categories`: Governance call to adjust merchant permissions.
   - **Storage**: Maps of merchant principals to approved categories.
   - **Security**: Role-based access; prevents unauthorized redemptions via cross-contract assertions.

5. **RedemptionHub** (`redemption-hub.clar`)
   - **Purpose**: Core logic for beneficiary redemptions, transferring value from vault to merchant.
   - **Key Functions**:
     - `redeem-voucher`: Beneficiary burns NFT, merchant claims STX if verified.
     - `claim-payment`: Merchant pulls funds post-redemption (to avoid front-running).
     - `validate-redemption`: Checks beneficiary eligibility, merchant approval, and expiry.
   - **Storage**: Redemption logs for auditing.
   - **Security**: Atomic transactions with `contract-call?`; uses `stx-transfer?` for payouts.

6. **AuditorDashboard** (`auditor-dashboard.clar`)
   - **Purpose**: Provides read-only transparency for donors, NGOs, and regulators.
   - **Key Functions**:
     - `get-campaign-stats`: Aggregates redemptions, funds used, and impact metrics.
     - `query-redemptions`: Filters by beneficiary or merchant.
     - `export-report`: Generates on-chain data dumps for off-chain analysis.
   - **Storage**: None (read-only); aggregates from other contracts.
   - **Security**: Public access; no state changes.

These contracts form a daisy-chain: DonorVault → VoucherIssuer → RedemptionHub → MerchantRegistry/BeneficiaryRegistry checks.

## Tech Stack
- **Blockchain**: Stacks (L2 on Bitcoin for security).
- **Language**: Clarity (secure, decidable smart contracts).
- **NFT Standard**: SIP-009 for vouchers.
- **Frontend (Suggested)**: React + Stacks.js for wallet integration (e.g., Leather wallet).
- **Testing**: Clarinet for unit/integration tests.
- **Deployment**: Hiro's Clarinet CLI.

## Installation & Setup

1. **Prerequisites**:
   - Node.js (v18+)
   - Rust (for Clarinet)
   - Stacks wallet (e.g., Leather)

2. **Clone & Install**:
   ```
   git clone <your-repo-url>
   cd aidvault
   npm install
   ```

3. **Development**:
   - Run local Stacks node: `clarinet integrate`
   - Test contracts: `clarinet test`
   - Deploy to testnet: `clarinet deploy --network testnet`

4. **Configuration**:
   - Edit `Clarity.toml` for contract paths.
   - Set admin principals in deployment scripts.

## Usage Example

1. **Donor Flow**:
   - Connect wallet, deposit 1000 STX to DonorVault.
   - Start campaign for 50 beneficiaries in "food" category.

2. **Beneficiary Flow**:
   - Register via BeneficiaryRegistry (submit ID proof off-chain).
   - Receive NFT voucher via wallet.
   - At merchant, call `redeem-voucher` with NFT ID.

3. **Merchant Flow**:
   - Register and get approved for categories.
   - After redemption, call `claim-payment` to receive STX.

## Roadmap
- **v1.0**: Core contracts deployed on testnet.
- **v1.1**: Integrate ZK-proofs for privacy-preserving verification.
- **v2.0**: Cross-chain support (e.g., Bitcoin Ordinals for vouchers).
- **Partnerships**: Collaborate with NGOs like Red Cross for pilots.

## Contributing
Fork the repo, create a feature branch, and submit a PR. Focus on security audits for Clarity code.

## License
MIT License. See [LICENSE](LICENSE) for details.