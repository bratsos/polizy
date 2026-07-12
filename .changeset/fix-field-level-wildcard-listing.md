---
"polizy": patch
---

- listSubjects/someoneCan/countSubjects on schemas with fieldLevelObjects now surface concrete subjects reachable through everyone(type) grants/memberships to group-acting types (previously check() allowed while the lists omitted them; field-free schemas were unaffected)
- isConditionValid now fails closed on malformed attribute shapes instead of throwing mid-check
