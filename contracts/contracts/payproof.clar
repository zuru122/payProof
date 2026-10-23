;; PayProof payment-request registry.
;;
;; This contract records the seller's requested payment and the result of an
;; independent verifier. It does not parse an unrelated Stacks transaction.
;; The verifier must validate the transaction through a trusted chain API
;; before calling mark-verified.

(define-constant ERR_UNAUTHORIZED u100)
(define-constant ERR_ALREADY_EXISTS u101)
(define-constant ERR_NOT_FOUND u102)
(define-constant ERR_INVALID_AMOUNT u103)
(define-constant ERR_INVALID_EXPIRY u104)
(define-constant ERR_INVALID_ASSET u105)
(define-constant ERR_NOT_PENDING u106)
(define-constant ERR_EXPIRED u107)
(define-constant ERR_TX_ALREADY_CLAIMED u108)

(define-constant STATUS_PENDING u0)
(define-constant STATUS_VERIFIED u1)
(define-constant STATUS_EXPIRED u2)
(define-constant STATUS_CANCELLED u3)
(define-constant STATUS_MISMATCH u4)

(define-data-var verifier principal tx-sender)

(define-map requests
  { request-id: (buff 64) }
  { seller: principal,
    amount: uint,
    asset: (string-ascii 128),
    created-at: uint,
    expires-at: uint,
    status: uint,
    tx-id: (optional (buff 32)) })

(define-map claimed-transactions
  { tx-id: (buff 32) }
  { request-id: (buff 64) })

(define-public (set-verifier (new-verifier principal))
  (begin
    (asserts! (is-eq tx-sender (var-get verifier)) (err ERR_UNAUTHORIZED))
    (var-set verifier new-verifier)
    (ok new-verifier)))

(define-public (register-request
    (request-id (buff 64))
    (amount uint)
    (asset (string-ascii 128))
    (expires-at uint))
  (begin
    (asserts! (is-none (map-get? requests { request-id: request-id })) (err ERR_ALREADY_EXISTS))
    (asserts! (> amount u0) (err ERR_INVALID_AMOUNT))
    (asserts! (> (len asset) u0) (err ERR_INVALID_ASSET))
    (asserts! (> expires-at stacks-block-height) (err ERR_INVALID_EXPIRY))
    (map-set requests { request-id: request-id }
      { seller: tx-sender,
        amount: amount,
        asset: asset,
        created-at: stacks-block-height,
        expires-at: expires-at,
        status: STATUS_PENDING,
        tx-id: none })
    (ok true)))

(define-public (update-request
    (request-id (buff 64))
    (amount uint)
    (asset (string-ascii 128))
    (expires-at uint))
  (let ((request (unwrap! (map-get? requests { request-id: request-id }) (err ERR_NOT_FOUND))))
    (asserts! (is-eq tx-sender (get seller request)) (err ERR_UNAUTHORIZED))
    (asserts! (is-eq (get status request) STATUS_PENDING) (err ERR_NOT_PENDING))
    (asserts! (> amount u0) (err ERR_INVALID_AMOUNT))
    (asserts! (> (len asset) u0) (err ERR_INVALID_ASSET))
    (asserts! (> expires-at stacks-block-height) (err ERR_INVALID_EXPIRY))
    (asserts! (< stacks-block-height (get expires-at request)) (err ERR_EXPIRED))
    (map-set requests { request-id: request-id }
      { seller: (get seller request),
        amount: amount,
        asset: asset,
        created-at: (get created-at request),
        expires-at: expires-at,
        status: STATUS_PENDING,
        tx-id: none })
    (ok true)))

(define-public (cancel-request (request-id (buff 64)))
  (let ((request (unwrap! (map-get? requests { request-id: request-id }) (err ERR_NOT_FOUND))))
    (asserts! (is-eq tx-sender (get seller request)) (err ERR_UNAUTHORIZED))
    (asserts! (is-eq (get status request) STATUS_PENDING) (err ERR_NOT_PENDING))
    (asserts! (< stacks-block-height (get expires-at request)) (err ERR_EXPIRED))
    (map-set requests { request-id: request-id }
      (merge request { status: STATUS_CANCELLED }))
    (ok true)))

(define-public (expire-request (request-id (buff 64)))
  (let ((request (unwrap! (map-get? requests { request-id: request-id }) (err ERR_NOT_FOUND))))
    (asserts! (is-eq (get status request) STATUS_PENDING) (err ERR_NOT_PENDING))
    (asserts! (>= stacks-block-height (get expires-at request)) (err ERR_INVALID_EXPIRY))
    (map-set requests { request-id: request-id }
      (merge request { status: STATUS_EXPIRED }))
    (ok true)))

(define-public (mark-verified (request-id (buff 64)) (tx-id (buff 32)))
  (let ((request (unwrap! (map-get? requests { request-id: request-id }) (err ERR_NOT_FOUND))))
    (asserts! (is-eq tx-sender (var-get verifier)) (err ERR_UNAUTHORIZED))
    (asserts! (is-eq (get status request) STATUS_PENDING) (err ERR_NOT_PENDING))
    (asserts! (< stacks-block-height (get expires-at request)) (err ERR_EXPIRED))
    (asserts! (is-none (map-get? claimed-transactions { tx-id: tx-id })) (err ERR_TX_ALREADY_CLAIMED))
    (map-set requests { request-id: request-id }
      (merge request { status: STATUS_VERIFIED, tx-id: (some tx-id) }))
    (map-set claimed-transactions { tx-id: tx-id } { request-id: request-id })
    (ok true)))

(define-read-only (get-verifier)
  (ok (var-get verifier)))

(define-read-only (get-request (request-id (buff 64)))
  (match (map-get? requests { request-id: request-id })
    request (ok (if (and (is-eq (get status request) STATUS_PENDING) (>= stacks-block-height (get expires-at request)))
                  (merge request { status: STATUS_EXPIRED })
                  request))
    (err ERR_NOT_FOUND)))

(define-read-only (get-claimed-request (tx-id (buff 32)))
  (ok (map-get? claimed-transactions { tx-id: tx-id })))
