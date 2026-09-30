///|
test "maximum binary body and declaration reject over-limit before body allocation" {
  let d = Decoder::new()
  let body = Bytes::from_array(Array::make(1048576, b'\x00'))
  ignore(d.feed(b"SEND\ncontent-length:1048576\n\n"))
  for i = 0; i < body.length(); i = i + 4096 {
    ignore(d.feed(slice(body, i, i + 4096)))
  }
  let events = d.feed(b"\x00")
  match events[0] {
    Frame(f) => assert_eq(f.body.length(), 1048576)
    _ => fail("frame")
  }
  d.end()
  let d = Decoder::new()
  assert_true(
    try {
      ignore(d.feed(b"SEND\ncontent-length:1048577\n\n"))
      false
    } catch {
      _ => true
    },
  )
}

///|
test "deterministic arbitrary multipart splits agree with fixed external wire expectations" {
  let wire = b"SEND\nx:\xe4\xb8\xad\xe6\x96\x87\\c\\n\ncontent-length:5\n\n\x00a\xff\r\n\x00ACK\nid:a\n\n\x00"
  let expected : Array[WireEvent] = [
    Frame(
      Frame::new(
        "SEND",
        [("x", "中文:\n"), ("content-length", "5")],
        body=b"\x00a\xff\r\n",
      ),
    ),
    Frame(Frame::new("ACK", [("id", "a")])),
  ]
  for run = 1; run <= 200; run = run + 1 {
    let d = Decoder::new()
    let out = []
    let mut pos = 0
    let mut seed = run
    while pos < wire.length() {
      seed = (seed * 17 + 31) % 997
      let next = Int::min(wire.length(), pos + seed % 11 + 1)
      for event in d.feed(slice(wire, pos, next)) {
        out.push(event)
      }
      pos = next
    }
    d.end()
    assert_eq(out, expected)
  }
}

///|
test "invalid outgoing frame leaves receipt and transaction state intact" {
  let c = active()
  assert_true(
    try {
      ignore(
        c.send(
          Frame::new("SEND", [("receipt", "r"), ("transaction", "unknown")]),
          0,
        ),
      )
      false
    } catch {
      _ => true
    },
  )
  assert_eq(c.pending_receipts(), 0)
  ignore(
    c.send(Frame::new("SEND", [("receipt", "r"), ("destination", "tasks")]), 0),
  )
  assert_eq(c.pending_receipts(), 1)
  let c = active()
  assert_true(
    try {
      ignore(c.send(Frame::new("COMMIT", []), 0))
      false
    } catch {
      _ => true
    },
  )
  assert_eq(c.state(), Active)
}

///|
test "ACK after unsubscribe retains original cumulative semantics" {
  let c = active()
  sub(c, "s", "client")
  message(c, "s", "a")
  message(c, "s", "b")
  ignore(c.send(unsubscribe("s"), 0))
  ignore(c.send(acknowledge("b"), 0))
  assert_eq(c.pending_deliveries(), 0)
}

///|
test "disconnect without receipt closes immediately and invalid clocks/config fail" {
  let c = active()
  ignore(c.send(Frame::new("DISCONNECT", []), 0))
  assert_eq(c.state(), Closed)
  assert_true(
    try {
      ignore(c.send(connect("local"), 0))
      false
    } catch {
      _ => true
    },
  )
  assert_true(
    try {
      ignore(Client::new(capacity=0))
      false
    } catch {
      _ => true
    },
  )
  assert_true(
    try {
      ignore(negotiate_heartbeat(-1, 0, 0, 0))
      false
    } catch {
      _ => true
    },
  )
  let c = active()
  assert_true(
    try {
      ignore(c.send(send_message("x", b"x"), -1))
      false
    } catch {
      _ => true
    },
  )
  assert_true(
    try {
      ignore(c.receive(b"\n", -1))
      false
    } catch {
      _ => true
    },
  )
  assert_eq(c.state(), Closed)
}
