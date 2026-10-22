;; counter.clar scaffolded by scaffold-stacks

(define-data-var counter uint u0)

(define-read-only (get-count)
  (ok (var-get counter)))

(define-public (increment)
  (begin
    (var-set counter (+ (var-get counter) u1))
    (ok (var-get counter))))

(define-public (decrement)
  (begin
    (asserts! (> (var-get counter) u0) (err u1))
    (var-set counter (- (var-get counter) u1))
    (ok (var-get counter))))

(define-public (reset)
  (begin
    (var-set counter u0)
    (ok u0)))
