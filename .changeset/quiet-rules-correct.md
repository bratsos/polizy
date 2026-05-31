---
"polizy": patch
---

Fix the JSDoc on `check`'s `consistency` option. It previously claimed every
check reads live and that `"default"` and `"strong"` behave identically — but
`"strong"` already pins reads to a point-in-time snapshot when the storage
adapter supports `withSnapshot`. The corrected comment ships in the emitted
type declarations (and the generated API reference).
