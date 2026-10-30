// New review-response regressions; fixed public baseline 0e60fe3.

///|
fn review_client(v : Version) -> Client raise {
  let c = Client::new()
  ignore(c.send(connect_versions("localhost", [v]), 0))
  ignore(
    c.receive(
      encode_versioned(Frame::new("CONNECTED", [("version", v.wire())]), v),
      0,
    ),
  )
  c
}

///|
fn review_delivery(
  c : Client,
  v : Version,
  sid : String,
  id : String,
) -> Frame raise {
  let hs = [("destination", "tasks"), ("subscription", sid), ("message-id", id)]
  if v == V12 {
    hs.push(("ack", "ack-\{id}"))
  }
  let f = Frame::new("MESSAGE", hs, body=b"binary\x00\xff")
  ignore(c.receive(encode_versioned(f, v), 0))
  f
}

///|
test "review 1.1 1.2 ACK NACK cumulative individual transaction commit abort matrix" {
  for v in [V11, V12] {
    for mode in ["client", "client-individual"] {
      for negative in [false, true] {
        for commit in [false, true] {
          let c = review_client(v)
          ignore(
            c.send(subscribe_versioned(v, "tasks", id="main", ack=mode), 0),
          )
          ignore(
            c.send(subscribe_versioned(v, "tasks", id="other", ack="client"), 0),
          )
          ignore(review_delivery(c, v, "main", "a"))
          ignore(review_delivery(c, v, "other", "x"))
          let last = review_delivery(c, v, "main", "b")
          ignore(c.send(begin_transaction("tx"), 0))
          ignore(
            c.send(
              send_message("tasks", b"transactional send", transaction="tx"),
              0,
            ),
          )
          let ack = acknowledge_message(v, last, negative~, transaction="tx")
          assert_eq(ack.command, if negative { "NACK" } else { "ACK" })
          if v == V11 {
            assert_eq(ack.header("message-id"), Some("b"))
            assert_eq(ack.header("subscription"), Some("main"))
          } else {
            assert_eq(ack.header("id"), Some("ack-b"))
          }
          ignore(c.send(ack, 0))
          assert_eq(c.pending_deliveries(), 3)
          ignore(c.send(finish_transaction("tx", commit~), 0))
          let remaining = if mode == "client" { 1 } else { 2 }
          assert_eq(c.pending_deliveries(), if commit { remaining } else { 3 })
          if !commit {
            ignore(c.send(acknowledge_message(v, last, negative~), 0))
            assert_eq(c.pending_deliveries(), remaining)
          }
          // Transaction identifiers can be reused only after their earlier transaction ends.
          ignore(c.send(begin_transaction("tx"), 0))
          ignore(c.send(finish_transaction("tx", commit=false), 0))
        }
      }
    }
  }
}

///|
test "review 1.1 1.2 auto acknowledgments do not allocate unsettled delivery state" {
  for v in [V11, V12] {
    let c = review_client(v)
    ignore(c.send(subscribe_versioned(v, "tasks", id="auto", ack="auto"), 0))
    let f = review_delivery(c, v, "auto", "a")
    assert_eq(c.pending_deliveries(), 0)
    assert_true(
      try {
        ignore(c.send(acknowledge_message(v, f), 0))
        false
      } catch {
        _ => true
      },
    )
  }
}

///|
test "review 1.1 1.2 subscription lifecycle receipt fence and independent subscriptions" {
  for v in [V11, V12] {
    let c = review_client(v)
    ignore(
      c.send(
        subscribe_versioned(v, "tasks", id="s", ack="client-individual"),
        0,
      ),
    )
    ignore(c.send(subscribe_versioned(v, "tasks", id="other", ack="auto"), 0))
    assert_true(
      try {
        ignore(c.send(subscribe_versioned(v, "tasks", id="s"), 0))
        false
      } catch {
        _ => true
      },
    )
    ignore(
      c.send(Frame::new("UNSUBSCRIBE", [("id", "s"), ("receipt", "gone")]), 0),
    )
    let in_flight = review_delivery(c, v, "s", "late")
    ignore(
      c.receive(
        encode_versioned(Frame::new("RECEIPT", [("receipt-id", "gone")]), v),
        0,
      ),
    )
    ignore(review_delivery(c, v, "other", "still-live"))
    assert_true(
      try {
        ignore(c.send(subscribe_versioned(v, "tasks", id="s"), 0))
        false
      } catch {
        _ => true
      },
    )
    ignore(c.send(acknowledge_message(v, in_flight), 0))
    ignore(c.send(subscribe_versioned(v, "tasks", id="s", ack="auto"), 0))
    assert_eq(c.pending_deliveries(), 0)
  }
}

///|
test "review cumulative ACK NACK may extend prefix inside the same transaction" {
  for v in [V11, V12] {
    for negative in [false, true] {
      for commit in [false, true] {
        let c = review_client(v)
        ignore(c.send(subscribe_versioned(v, "tasks", id="s", ack="client"), 0))
        let first = review_delivery(c, v, "s", "a")
        let last = review_delivery(c, v, "s", "b")
        ignore(c.send(begin_transaction("tx"), 0))
        ignore(c.send(begin_transaction("other"), 0))
        ignore(
          c.send(acknowledge_message(v, first, negative~, transaction="tx"), 0),
        )
        assert_true(
          try {
            ignore(
              c.send(
                acknowledge_message(v, last, negative~, transaction="other"),
                0,
              ),
            )
            false
          } catch {
            _ => true
          },
        )
        assert_eq(c.pending_deliveries(), 2)
        ignore(
          c.send(acknowledge_message(v, last, negative~, transaction="tx"), 0),
        )
        assert_eq(c.pending_deliveries(), 2)
        ignore(c.send(finish_transaction("tx", commit~), 0))
        assert_eq(c.pending_deliveries(), if commit { 0 } else { 2 })
        if !commit {
          ignore(c.send(acknowledge_message(v, last, negative~), 0))
          assert_eq(c.pending_deliveries(), 0)
        }
      }
    }
  }
}
