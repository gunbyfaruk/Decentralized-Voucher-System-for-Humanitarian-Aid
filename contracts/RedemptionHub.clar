(define-constant ERR_NOT_AUTHORIZED u100)
(define-constant ERR_INVALID_VOUCHER u101)
(define-constant ERR_EXPIRED u102)
(define-constant ERR_MERCHANT_NOT_APPROVED u103)
(define-constant ERR_INVALID_AMOUNT u104)
(define-constant ERR_ALREADY_REDEEMED u105)
(define-constant ERR_INVALID_CAMPAIGN u106)
(define-constant ERR_INSUFFICIENT_FUNDS u107)
(define-constant ERR_INVALID_BENEFICIARY u108)
(define-constant ERR_INVALID_MERCHANT u109)
(define-constant ERR_INVALID_TIMESTAMP u110)

(define-data-var contract-owner principal tx-sender)
(define-data-var redemption-fee uint u100)
(define-data-var max-redemptions-per-block uint u1000)
(define-data-var total-redemptions uint u0)

(define-map redemptions
  { voucher-id: uint }
  { 
    beneficiary: principal,
    merchant: principal,
    amount: uint,
    timestamp: uint,
    campaign-id: uint,
    category: (string-utf8 50),
    redeemed: bool
  }
)

(define-map redemption-stats
  { campaign-id: uint }
  { total-amount: uint, redemption-count: uint }
)

(define-read-only (get-redemption (voucher-id uint))
  (map-get? redemptions { voucher-id: voucher-id })
)

(define-read-only (get-campaign-stats (campaign-id uint))
  (map-get? redemption-stats { campaign-id: campaign-id })
)

(define-read-only (get-total-redemptions)
  (ok (var-get total-redemptions))
)

(define-read-only (get-redemption-fee)
  (ok (var-get redemption-fee))
)

(define-private (validate-voucher (voucher-id uint))
  (let
    (
      (voucher (unwrap! (map-get? redemptions { voucher-id: voucher-id }) (err ERR_INVALID_VOUCHER)))
      (voucher-details (unwrap! (contract-call? .voucher-issuer get-voucher-details voucher-id) (err ERR_INVALID_VOUCHER)))
      (expiry (get expiry voucher-details))
      (campaign-id (get campaign-id voucher-details))
      (category (get category voucher-details))
    )
    (asserts! (not (get redeemed voucher)) (err ERR_ALREADY_REDEEMED))
    (asserts! (> expiry block-height) (err ERR_EXPIRED))
    (asserts! (> (get amount voucher) u0) (err ERR_INVALID_AMOUNT))
    (ok { campaign-id: campaign-id, category: category, amount: (get amount voucher) })
  )
)

(define-private (validate-beneficiary (beneficiary principal) (campaign-id uint))
  (let
    (
      (is-eligible (contract-call? .beneficiary-registry is-eligible beneficiary))
    )
    (asserts! is-eligible (err ERR_INVALID_BENEFICIARY))
    (ok true)
  )
)

(define-private (validate-merchant (merchant principal) (category (string-utf8 50)))
  (let
    (
      (is-approved (contract-call? .merchant-registry is-approved merchant category))
    )
    (asserts! is-approved (err ERR_MERCHANT_NOT_APPROVED))
    (ok true)
  )
)

(define-private (validate-campaign (campaign-id uint) (amount uint))
  (let
    (
      (campaign (unwrap! (contract-call? .donor-vault get-campaign campaign-id) (err ERR_INVALID_CAMPAIGN)))
      (available-funds (get available-funds campaign))
    )
    (asserts! (>= available-funds amount) (err ERR_INSUFFICIENT_FUNDS))
    (ok true)
  )
)

(define-public (set-redemption-fee (new-fee uint))
  (begin
    (asserts! (is-eq tx-sender (var-get contract-owner)) (err ERR_NOT_AUTHORIZED))
    (var-set redemption-fee new-fee)
    (ok true)
  )
)

(define-public (set-max-redemptions-per-block (new-max uint))
  (begin
    (asserts! (is-eq tx-sender (var-get contract-owner)) (err ERR_NOT_AUTHORIZED))
    (asserts! (> new-max u0) (err ERR_INVALID_AMOUNT))
    (var-set max-redemptions-per-block new-max)
    (ok true)
  )
)

(define-public (redeem-voucher (voucher-id uint) (merchant principal))
  (let
    (
      (voucher (unwrap! (map-get? redemptions { voucher-id: voucher-id }) (err ERR_INVALID_VOUCHER)))
      (voucher-details (try! (validate-voucher voucher-id)))
      (beneficiary tx-sender)
      (amount (get amount voucher-details))
      (campaign-id (get campaign-id voucher-details))
      (category (get category voucher-details))
      (current-redemptions (var-get total-redemptions))
    )
    (asserts! (<= current-redemptions (var-get max-redemptions-per-block)) (err ERR_NOT_AUTHORIZED))
    (try! (validate-beneficiary beneficiary campaign-id))
    (try! (validate-merchant merchant category))
    (try! (validate-campaign campaign-id amount))
    (try! (contract-call? .voucher-issuer burn-voucher voucher-id))
    (try! (stx-transfer? (var-get redemption-fee) beneficiary (var-get contract-owner)))
    (try! (contract-call? .donor-vault transfer-funds merchant amount))
    (map-set redemptions
      { voucher-id: voucher-id }
      { 
        beneficiary: beneficiary,
        merchant: merchant,
        amount: amount,
        timestamp: block-height,
        campaign-id: campaign-id,
        category: category,
        redeemed: true
      }
    )
    (map-set redemption-stats
      { campaign-id: campaign-id }
      { 
        total-amount: (+ (get total-amount (default-to { total-amount: u0, redemption-count: u0 } (map-get? redemption-stats { campaign-id: campaign-id }))) amount),
        redemption-count: (+ (get redemption-count (default-to { total-amount: u0, redemption-count: u0 } (map-get? redemption-stats { campaign-id: campaign-id }))) u1)
      }
    )
    (var-set total-redemptions (+ current-redemptions u1))
    (print { event: "voucher-redeemed", voucher-id: voucher-id, beneficiary: beneficiary, merchant: merchant, amount: amount })
    (ok true)
  )
)

(define-public (claim-payment (voucher-id uint))
  (let
    (
      (redemption (unwrap! (map-get? redemptions { voucher-id: voucher-id }) (err ERR_INVALID_VOUCHER)))
      (merchant tx-sender)
    )
    (asserts! (is-eq merchant (get merchant redemption)) (err ERR_INVALID_MERCHANT))
    (asserts! (get redeemed redemption) (err ERR_INVALID_VOUCHER))
    (ok true)
  )
)