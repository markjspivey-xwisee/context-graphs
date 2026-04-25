# Federated Transactions

When an action requires writes to multiple pods to succeed
together-or-not-at-all, Interego provides a saga-pattern transaction
protocol. This is the federated equivalent of database transactions —
no central coordinator, atomicity through compensating actions.

## Status

**Layer 1 spec, runtime stub.** Reference implementation in
`src/transactions/` covers the local-multi-pod case (single
coordinator, multiple participants). Full Byzantine-fault-tolerant
multi-coordinator transactions are out of scope; not all pods are
expected to participate in every transaction class.

## Why not 2PC?

Two-phase commit requires participants to hold locks during the
voting phase. Cross-pod, that's: every pod blocks reads against its
descriptors until the coordinator commits or aborts. Slow under
network partitions and prone to coordinator failure. Sagas trade
isolation for availability — each step commits independently, with
explicit compensation if a later step fails.

## The protocol

A `cg:Transaction` is itself a `cg:ContextDescriptor` carrying:

```turtle
<urn:txn:42> a cg:Transaction ;
    cg:txnState cg:TxnPending ;
    cg:hasStep <urn:txn:42/step-1>, <urn:txn:42/step-2>, <urn:txn:42/step-3> ;
    cg:txnIsolation cg:ReadCommitted ;
    cg:txnCoordinator <urn:agent:alice> .

<urn:txn:42/step-1> a cg:TransactionStep ;
    cg:targetPod <https://pod-a.example/> ;
    cg:forwardAction <urn:action:publish-descriptor-A> ;
    cg:compensatingAction <urn:action:retract-descriptor-A> ;
    cg:stepOrder 1 ;
    cg:stepState cg:StepCommitted .
```

Each step has:
- **forward action:** the operation that achieves the desired effect on the target pod
- **compensating action:** the operation that undoes it, idempotent under retry

Transactions execute steps in `cg:stepOrder`. If any step fails:
1. Mark step as `cg:StepFailed`.
2. Walk completed steps in reverse, executing each `compensatingAction`.
3. Mark transaction as `cg:TxnAborted`.

If all steps succeed:
1. Mark transaction as `cg:TxnCommitted`.
2. Optionally publish a `cg:TransactionLog` summary descriptor.

## Isolation levels

- **`cg:ReadUncommitted`** — readers may see in-progress writes. Cheapest. Acceptable when atomic visibility doesn't matter (e.g., logging).
- **`cg:ReadCommitted`** — readers see only committed data. Each pod marks pending writes invisible until the transaction's `cg:txnState` becomes `cg:TxnCommitted`. Default.
- **`cg:RepeatableRead`** — within a transaction, repeated reads of the same descriptor return the same value. Implementation: snapshot descriptor versions at transaction start.
- **`cg:Serializable`** — no concurrent transactions can see each other's effects. Highest cost; requires either single-coordinator scheduling or distributed conflict detection.

## Failure modes

- **Coordinator crashes mid-transaction:** the transaction descriptor on the coordinator's pod records committed steps. On recovery, replay or compensate.
- **Participant pod unreachable:** retry with backoff. After threshold, abort + compensate.
- **Compensating action also fails:** raise a `cg:TxnPartialAbort`. Manual reconciliation required. The transaction descriptor records exactly which steps committed and which compensations failed, so the situation is auditable.
- **Network partition splits coordinator from participants mid-commit:** the coordinator's view becomes the authority. Participants that committed after losing contact may need to reconcile when the partition heals.

## Composition with other primitives

- **ABAC:** transactions can carry their own `cg:AccessControlPolicy`; only authorized agents can begin or compensate.
- **cg:supersedes:** a committed transaction's effects on a descriptor are recorded as a supersession with the transaction IRI as the cause.
- **AMTA attestations:** an attestor can certify that a particular transaction completed correctly; useful for high-stakes workflows.
- **Capability passport:** a successful transaction is a `passport:LifeEvent` for the coordinator.

## What this enables

- **Cross-pod review workflows:** "merge PR" transaction writes the merge marker to repo-pod, the audit trail to logging-pod, and the reviewer-credit to reviewer-pod, all atomic.
- **Multi-party agreements:** "contract sign" writes A's signed copy to A's pod, B's signed copy to B's pod, and the bilateral agreement to a witness pod, all-or-nothing.
- **Capability acquisition:** "agent earns capability" writes the proof descriptor to the agent's pod, the attestation to the attestor's pod, and updates the registry — committed together.

## Reference runtime

`src/transactions/` provides:
- `createTransaction(steps, coordinator)` → `Transaction`
- `executeTransaction(txn)` → `TxnResult` (Committed | Aborted | PartialAbort)
- `compensate(txn)` → reverses committed steps in reverse order
- `transactionStatus(txn)` → snapshot of where each step is
