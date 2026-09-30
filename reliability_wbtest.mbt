///|
test "individual ACK and NACK settle only the selected delivery" {
  let c = active()
  sub(c, "s", "client-individual")
  message(c, "s", "a")
  message(c, "s", "b")
  ignore(c.send(Frame::new("NACK", [("id", "b")]), 0))
  assert_eq(c.pending_deliveries(), 1)
  assert_true(
    try {
      ignore(c.send(Frame::new("ACK", [("id", "b")]), 0))
      false
    } catch {
      _ => true
    },
  )
  ignore(c.send(Frame::new("ACK", [("id", "a")]), 0))
  assert_eq(c.pending_deliveries(), 0)
}

///|
test "cumulative ACK and NACK stay within their subscription" {
  let c = active()
  sub(c, "s", "client")
  sub(c, "t", "client")
  message(c, "s", "a")
  message(c, "t", "b")
  message(c, "s", "c")
  ignore(c.send(Frame::new("ACK", [("id", "c")]), 0))
  assert_eq(c.pending_deliveries(), 1)
  ignore(c.send(Frame::new("NACK", [("id", "b")]), 0))
  assert_eq(c.pending_deliveries(), 0)
}

///|
test "transaction abort restores ACK eligibility commit removes deliveries" {
  let c = active()
  sub(c, "s", "client-individual")
  message(c, "s", "a")
  ignore(c.send(Frame::new("BEGIN", [("transaction", "tx")]), 0))
  assert_true(
    try {
      ignore(c.send(Frame::new("BEGIN", [("transaction", "tx")]), 0))
      false
    } catch {
      _ => true
    },
  )
  ignore(
    c.send(
      Frame::new(
        "SEND",
        [("destination", "tasks"), ("transaction", "tx")],
        body=b"job",
      ),
      0,
    ),
  )
  ignore(c.send(Frame::new("ACK", [("id", "a"), ("transaction", "tx")]), 0))
  assert_eq(c.pending_deliveries(), 1)
  assert_true(
    try {
      ignore(c.send(Frame::new("NACK", [("id", "a")]), 0))
      false
    } catch {
      _ => true
    },
  )
  ignore(c.send(Frame::new("ABORT", [("transaction", "tx")]), 0))
  ignore(c.send(Frame::new("BEGIN", [("transaction", "other")]), 0))
  ignore(c.send(Frame::new("NACK", [("id", "a"), ("transaction", "other")]), 0))
  ignore(c.send(Frame::new("COMMIT", [("transaction", "other")]), 0))
  assert_eq(c.pending_deliveries(), 0)
  assert_true(
    try {
      ignore(
        c.send(
          Frame::new("SEND", [("destination", "x"), ("transaction", "tx")]),
          0,
        ),
      )
      false
    } catch {
      _ => true
    },
  )
}

///|
test "cumulative transactional overlap is rejected without partial mutation" {
  let c = active()
  sub(c, "s", "client")
  message(c, "s", "a")
  message(c, "s", "b")
  ignore(c.send(Frame::new("BEGIN", [("transaction", "tx")]), 0))
  ignore(c.send(Frame::new("ACK", [("id", "a"), ("transaction", "tx")]), 0))
  assert_true(
    try {
      ignore(c.send(Frame::new("ACK", [("id", "b")]), 0))
      false
    } catch {
      _ => true
    },
  )
  assert_eq(c.pending_deliveries(), 2)
  ignore(c.send(Frame::new("ABORT", [("transaction", "tx")]), 0))
  ignore(c.send(Frame::new("ACK", [("id", "b")]), 0))
  assert_eq(c.pending_deliveries(), 0)
}

///|
test "capacity limits and invalid MESSAGE release all state" {
  let c = active(capacity=1, max_pending=1)
  sub(c, "s", "client-individual")
  assert_true(
    try {
      sub(c, "t", "auto")
      false
    } catch {
      _ => true
    },
  )
  ignore(c.send(Frame::new("BEGIN", [("transaction", "x")]), 0))
  assert_true(
    try {
      ignore(c.send(Frame::new("BEGIN", [("transaction", "y")]), 0))
      false
    } catch {
      _ => true
    },
  )
  message(c, "s", "a")
  assert_true(
    try {
      message(c, "s", "b")
      false
    } catch {
      _ => true
    },
  )
  assert_eq(c.state(), Closed)
  assert_eq(c.pending_deliveries(), 0)
}

///|
test "missing MESSAGE acknowledgement and duplicate id are fatal" {
  let c = active()
  sub(c, "s", "client")
  assert_true(
    try {
      ignore(
        c.receive(
          b"MESSAGE\nsubscription:s\ndestination:x\nmessage-id:a\n\n\x00", 0,
        ),
      )
      false
    } catch {
      _ => true
    },
  )
  let c = active()
  sub(c, "s", "client")
  message(c, "s", "a")
  assert_true(
    try {
      message(c, "s", "a")
      false
    } catch {
      _ => true
    },
  )
}
