;; donor-vault.clar
(define-constant ERR-NOT-AUTHORIZED u100)
(define-constant ERR-CAMPAIGN-NOT-FOUND u101)
(define-constant ERR-CAMPAIGN-EXPIRED u102)
(define-constant ERR-INSUFFICIENT-FUNDS u103)
(define-constant ERR-INVALID-AMOUNT u104)
(define-constant ERR-INVALID-EXPIRY u105)
(define-constant ERR-INVALID-BENEFICIARY-COUNT u106)
(define-constant ERR-CAMPAIGN-ACTIVE u107)
(define-constant ERR-CAMPAIGN-ENDED u108)
(define-constant ERR-REFUND-NOT-ALLOWED u109)
(define-constant ERR-WITHDRAWAL-LOCKED u110)
(define-constant ERR-INVALID-CATEGORY u111)
(define-constant ERR-ZERO-VALUE u112)
(define-constant ERR-EXCESS-WITHDRAWAL u113)
(define-constant ERR-INVALID-STATE u114)
(define-constant ERR-ADMIN-ONLY u115)
(define-constant ERR-PAUSED u116)
(define-constant ERR-NOT-PAUSED u117)

(define-data-var contract-owner principal tx-sender)
(define-data-var paused bool false)
(define-data-var next-campaign-id uint u0)
(define-data-var platform-fee-rate uint u250)
(define-data-var max-campaign-duration uint u525600)
(define-data-var min-campaign-amount uint u1000000)

(define-map campaigns
  uint
  {
    donor: principal,
    total-budget: uint,
    remaining-funds: uint,
    beneficiary-count: uint,
    expiry-block: uint,
    category: (string-ascii 50),
    status: (string-ascii 20),
    created-at: uint,
    ended-at: (optional uint),
    redeemed-count: uint
  }
)

(define-map donor-campaigns
  principal
  (list 100 uint)
)

(define-map category-whitelist
  (string-ascii 50)
  bool
)

(define-read-only (get-campaign (campaign-id uint))
  (map-get? campaigns campaign-id)
)

(define-read-only (get-donor-campaigns (donor principal))
  (map-get? donor-campaigns donor)
)

(define-read-only (is-category-allowed (category (string-ascii 50)))
  (default-to false (map-get? category-whitelist category))
)

(define-read-only (get-contract-balance)
  (stx-get-balance (as-contract tx-sender))
)

(define-read-only (is-paused)
  (var-get paused)
)

(define-private (validate-amount (amount uint))
  (and (> amount u0) (>= amount (var-get min-campaign-amount)))
)

(define-private (validate-expiry (expiry uint))
  (and (> expiry block-height) (<= (- expiry block-height) (var-get max-campaign-duration)))
)

(define-private (validate-beneficiary-count (count uint))
  (> count u0)
)

(define-private (validate-category (category (string-ascii 50)))
  (and (> (len category) u0) (<= (len category) u50) (is-category-allowed category))
)

(define-private (assert-admin)
  (asserts! (is-eq tx-sender (var-get contract-owner)) (err ERR-ADMIN-ONLY))
)

(define-private (assert-not-paused)
  (asserts! (not (var-get paused)) (err ERR-PAUSED))
)

(define-public (set-paused (new-state bool))
  (begin
    (try! (assert-admin))
    (var-set paused new-state)
    (ok true)
  )
)

(define-public (set-platform-fee (new-rate uint))
  (begin
    (try! (assert-admin))
    (asserts! (<= new-rate u1000) (err ERR-INVALID-AMOUNT))
    (var-set platform-fee-rate new-rate)
    (ok true)
  )
)

(define-public (set-min-campaign-amount (amount uint))
  (begin
    (try! (assert-admin))
    (asserts! (> amount u0) (err ERR-ZERO-VALUE))
    (var-set min-campaign-amount amount)
    (ok true)
  )
)

(define-public (add-category (category (string-ascii 50)))
  (begin
    (try! (assert-admin))
    (asserts! (> (len category) u0) (err ERR-INVALID-CATEGORY))
    (map-set category-whitelist category true)
    (ok true)
  )
)

(define-public (remove-category (category (string-ascii 50)))
  (begin
    (try! (assert-admin))
    (map-delete category-whitelist category)
    (ok true)
  )
)

(define-public (deposit-and-create-campaign
  (total-budget uint)
  (beneficiary-count uint)
  (expiry-block uint)
  (category (string-ascii 50))
)
  (let (
    (campaign-id (var-get next-campaign-id))
    (fee-amount (/ (* total-budget (var-get platform-fee-rate)) u10000))
    (net-budget (- total-budget fee-amount))
    (current-campaigns (default-to (list) (map-get? donor-campaigns tx-sender)))
  )
    (try! (assert-not-paused))
    (asserts! (validate-amount total-budget) (err ERR-INVALID-AMOUNT))
    (asserts! (validate-beneficiary-count beneficiary-count) (err ERR-INVALID-BENEFICIARY-COUNT))
    (asserts! (validate-expiry expiry-block) (err ERR-INVALID-EXPIRY))
    (asserts! (validate-category category) (err ERR-INVALID-CATEGORY))
    (try! (stx-transfer? total-budget tx-sender (as-contract tx-sender)))
    (map-set campaigns campaign-id
      {
        donor: tx-sender,
        total-budget: net-budget,
        remaining-funds: net-budget,
        beneficiary-count: beneficiary-count,
        expiry-block: expiry-block,
        category: category,
        status: "active",
        created-at: block-height,
        ended-at: none,
        redeemed-count: u0
      }
    )
    (map-set donor-campaigns tx-sender (append current-campaigns campaign-id))
    (var-set next-campaign-id (+ campaign-id u1))
    (print { event: "campaign-created", id: campaign-id, donor: tx-sender, budget: net-budget })
    (ok campaign-id)
  )
)

(define-public (extend-campaign-expiry (campaign-id uint) (new-expiry uint))
  (let ((campaign (unwrap! (map-get? campaigns campaign-id) (err ERR-CAMPAIGN-NOT-FOUND))))
    (asserts! (is-eq (get donor campaign) tx-sender) (err ERR-NOT-AUTHORIZED))
    (asserts! (is-eq (get status campaign) "active") (err ERR-CAMPAIGN-ENDED))
    (asserts! (> new-expiry (get expiry-block campaign)) (err ERR-INVALID-EXPIRY))
    (asserts! (<= (- new-expiry (get expiry-block campaign)) u52560) (err ERR-INVALID-EXPIRY))
    (map-set campaigns campaign-id (merge campaign { expiry-block: new-expiry }))
    (ok true)
  )
)

(define-public (cancel-campaign (campaign-id uint))
  (let (
    (campaign (unwrap! (map-get? campaigns campaign-id) (err ERR-CAMPAIGN-NOT-FOUND)))
    (remaining (get remaining-funds campaign))
  )
    (asserts! (is-eq (get donor campaign) tx-sender) (err ERR-NOT-AUTHORIZED))
    (asserts! (is-eq (get status campaign) "active") (err ERR-CAMPAIGN-ENDED))
    (asserts! (> block-height (get expiry-block campaign)) (err ERR-CAMPAIGN-ACTIVE))
    (asserts! (is-eq (get redeemed-count campaign) u0) (err ERR-CAMPAIGN-ACTIVE))
    (try! (as-contract (stx-transfer? remaining (as-contract tx-sender) tx-sender)))
    (map-set campaigns campaign-id (merge campaign { status: "cancelled", remaining-funds: u0, ended-at: (some block-height) }))
    (ok true)
  )
)

(define-public (withdraw-excess-funds (campaign-id uint) (amount uint))
  (let (
    (campaign (unwrap! (map-get? campaigns campaign-id) (err ERR-CAMPAIGN-NOT-FOUND)))
    (remaining (get remaining-funds campaign))
    (per-beneficiary (/ remaining (get beneficiary-count campaign)))
  )
    (asserts! (is-eq (get donor campaign) tx-sender) (err ERR-NOT-AUTHORIZED))
    (asserts! (or (is-eq (get status campaign) "active") (is-eq (get status campaign) "ended")) (err ERR-INVALID-STATE))
    (asserts! (> block-height (get expiry-block campaign)) (err ERR-WITHDRAWAL-LOCKED))
    (asserts! (<= amount (- remaining (* per-beneficiary (get beneficiary-count campaign)))) (err ERR-EXCESS-WITHDRAWAL))
    (try! (as-contract (stx-transfer? amount (as-contract tx-sender) tx-sender)))
    (map-set campaigns campaign-id (merge campaign { remaining-funds: (- remaining amount) }))
    (ok true)
  )
)

(define-public (end-campaign-manually (campaign-id uint))
  (let ((campaign (unwrap! (map-get? campaigns campaign-id) (err ERR-CAMPAIGN-NOT-FOUND))))
    (asserts! (is-eq (get donor campaign) tx-sender) (err ERR-NOT-AUTHORIZED))
    (asserts! (is-eq (get status campaign) "active") (err ERR-CAMPAIGN-ENDED))
    (map-set campaigns campaign-id (merge campaign { status: "ended", ended-at: (some block-height) }))
    (ok true)
  )
)

(define-public (release-funds-to-merchant (campaign-id uint) (amount uint) (merchant principal))
  (let (
    (campaign (unwrap! (map-get? campaigns campaign-id) (err ERR-CAMPAIGN-NOT-FOUND)))
    (remaining (get remaining-funds campaign))
  )
    (asserts! (is-eq (get status campaign) "active") (err ERR-CAMPAIGN-ENDED))
    (asserts! (<= block-height (get expiry-block campaign)) (err ERR-CAMPAIGN-EXPIRED))
    (asserts! (>= remaining amount) (err ERR-INSUFFICIENT-FUNDS))
    (asserts! (> amount u0) (err ERR-ZERO-VALUE))
    (try! (as-contract (stx-transfer? amount (as-contract tx-sender) merchant)))
    (map-set campaigns campaign-id
      (merge campaign {
        remaining-funds: (- remaining amount),
        redeemed-count: (+ (get redeemed-count campaign) u1)
      })
    )
    (ok true)
  )
)

(define-public (emergency-withdraw (amount uint))
  (begin
    (try! (assert-admin))
    (try! (as-contract (stx-transfer? amount (as-contract tx-sender) (var-get contract-owner))))
    (ok true)
  )
)