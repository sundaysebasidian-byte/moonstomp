# Unsubscribe refusal and retry

`Subscription.unsubscribe()` temporarily enters `closing` and cancels this handle's pending `next()` calls. On a receipt-confirmed unsubscribe it closes. A failure with `outcomeUnknown === false` restores `active` only while the client remains active: the command is known not to have crossed the write boundary, so the subscription still exists. A new cancellation controller permits subsequent `next()` calls; earlier cancelled promises remain cancelled. This does not automatically retry.

A write-attempted/unknown failure, a closed connection, or a confirmed unsubscribe leaves the handle closed. The client must not infer broker rollback, replay an unknown unsubscribe, or resurrect a subscription after connection closure. A concurrent second unsubscribe is rejected while the first is closing.

Regression coverage includes three protocol versions, waiter exhaustion before write, actual message consumption after capacity recovery, and a confirmed retry. Separate lifecycle controls cover concurrent calls and known/unknown failure classification. Independent real TCP cases additionally cover write-after receipt timeout, peer closure, buffer refusal with connection closure, and pending-read cancellation. Scripted loopback peers are not production broker evidence.
