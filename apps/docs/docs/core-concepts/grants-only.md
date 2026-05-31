---
title: Why Grants-Only
sidebar_position: 4
---

# Why Grants-Only

When designing permissions in polizy, you might wonder how to handle rules like "allow everyone in the team to edit, except for Bob." 

If you are used to traditional Access Control Lists (ACLs) or Policy-Based Access Control (PBAC), you might look for a way to write a "deny" rule. However, polizy operates on a **grants-only** philosophy.

Understanding this philosophy—and the trade-offs that come with polizy's embedded architecture—is key to designing secure and maintainable authorization schemas.

---

## The Grants-Only Philosophy

Like Google's Zanzibar, polizy only stores positive assertions. A tuple represents the presence of a relationship (a grant), never its absence or a prohibition. There are no "deny" tuples.

If no path can be found in the relationship graph connecting a subject to the object via a satisfying relation, access is **denied by default** (fail-closed).

### Why positive-only?
1. **Predictability**: In systems that allow both "allow" and "deny" rules, resolving conflicts becomes incredibly complex. You have to decide which rule takes precedence, which can easily lead to accidental privilege leaks or lockouts.
2. **Performance**: Graph traversal algorithms can scale efficiently when they only need to find *a* path. Evaluating negation across distributed graphs is computationally expensive and difficult to cache.

### Modeling Exceptions
To model exceptions without "deny" rules, you adjust your relationship graph or schema design. 

For example, instead of granting a team access to a folder and then trying to deny Bob:
* **Narrower Relations**: Grant access to specific resources rather than the entire parent container.
* **Sub-groups**: Split the team into two groups—one containing Bob, and one without Bob—and grant the folder access to the group without Bob.

---

## The Scope of Conditions

polizy allows you to attach **conditions** to tuples (such as a time window or attribute-based predicates like checking a user's department). 

It is important to understand that conditions in polizy are **guards on relations**, not a replacement for a full policy engine (like Open Policy Agent/Rego). They are designed for simple gates evaluated at check time, such as:
* Restricting a contractor's access to a 3-month window.
* Verifying that a check-time IP address or department matches a criteria.

If you find yourself writing complex, nested logical predicates in your tuple conditions, you should look for ways to represent those rules as relations in your schema instead.

For practical examples of temporary grants, see [Temporary Access](../guides/temporary-access.md).

---

## Embedded (In-Process) vs. External Services

Most Zanzibar-inspired authorization engines (like SpiceDB, Ory Keto, or OpenFGA) are designed as external, distributed microservices. polizy takes a different approach: **it is fully embedded**.

| Feature | polizy (Embedded) | External Zanzibar Services |
| --- | --- | --- |
| **Infrastructure** | Runs in-process on your application server. | Requires deploying and managing a separate service cluster. |
| **Latency** | Extremely low; no network hop for checks. | Network latency overhead for every authorization query. |
| **Storage** | Connects to your existing database (via Prisma, etc.). | Requires its own database (typically CockroachDB or Spanner). |
| **Deployment** | Part of your application code. | Must be updated and scaled independently. |

polizy gives you the powerful graph-traversal model of Zanzibar without the operational complexity of running a separate distributed database cluster.

---

## Consistency and Limitations

Because polizy is embedded and database-agnostic, it handles consistency differently than distributed Zanzibar services:

### No Cross-Operation Consistency Tokens
Distributed Zanzibar systems prevent the "new enemy problem" (a race condition where a stale cache allows a removed user to view a new document) using consistency tokens called "zookies."

polizy **does not support cross-operation consistency tokens**. Access checks always reflect the current state of your database. 
* To ensure a point-in-time snapshot *within* a single batch of checks or page render, you can use `consistency: "strong"` inside a read scope.
* Across different operations or requests, polizy relies on the underlying storage engine's commit consistency.

To read more about optimizing check performance and managing point-in-time reads, see [Consistency and Read Scopes](../performance/consistency.md).
