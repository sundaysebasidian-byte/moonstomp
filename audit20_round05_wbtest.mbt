///|
test "audit20 R05 capacity classes independent and reusable after release" {
  let c = active(capacity=1, max_pending=1)
  sub(c, "A", "client-individual")
  ignore(c.send(begin_transaction("T"), 0))
  ignore(c.send(send_message("tasks", b"x", receipt="R"), 0))
  assert_eq(c.subscriptions.length(), 1)
  assert_eq(c.transactions.length(), 1)
  assert_eq(c.pending_receipts(), 1)
  for
    f in [
      subscribe("B", "tasks"),
      begin_transaction("U"),
      send_message("tasks", b"y", receipt="S"),
    ] {
    assert_true(
      try {
        ignore(c.send(f, 0))
        false
      } catch {
        _ => true
      },
    )
    assert_eq(c.state(), Active)
    assert_eq(c.subscriptions.length(), 1)
    assert_eq(c.transactions.length(), 1)
    assert_eq(c.pending_receipts(), 1)
  }
  message(c, "A", "a")
  ignore(c.send(acknowledge("a"), 0))
  message(c, "A", "b")
  ignore(c.send(acknowledge("b"), 0))
  ignore(c.send(finish_transaction("T"), 0))
  ignore(c.send(unsubscribe("A"), 0))
  ignore(c.receive(b"RECEIPT\nreceipt-id:R\n\n\x00", 0))
  sub(c, "B", "auto")
  ignore(c.send(begin_transaction("U"), 0))
  ignore(c.send(send_message("tasks", b"z", receipt="S"), 0))
  assert_eq(c.pending_receipts(), 1)
  assert_eq(c.pending_deliveries(), 0)
  c.fail()
  assert_eq(c.subscriptions.length(), 0)
  assert_eq(c.transactions.length(), 0)
  assert_eq(c.pending_receipts(), 0)
}

///|
test "audit20 R05 pending delivery overflow closes all owned state" {
  let c = active(capacity=1, max_pending=1)
  sub(c, "A", "client")
  ignore(c.send(begin_transaction("T"), 0))
  ignore(c.send(send_message("tasks", b"x", receipt="R"), 0))
  message(c, "A", "a")
  assert_true(
    try {
      message(c, "A", "b")
      false
    } catch {
      _ => true
    },
  )
  assert_eq(c.state(), Closed)
  assert_eq(c.pending_deliveries(), 0)
  assert_eq(c.pending_receipts(), 0)
  assert_eq(c.transactions.length(), 0)
  assert_eq(c.subscriptions.length(), 0)
}
