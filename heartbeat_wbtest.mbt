///|
test "heartbeat max negotiation disabled directions" {
  assert_eq(negotiate_heartbeat(10, 20, 30, 40), {
    send_ms: 40,
    receive_ms: 30,
  })
  assert_eq(negotiate_heartbeat(0, 20, 0, 40), { send_ms: 0, receive_ms: 0, })
  assert_eq(heartbeat_pair("0,100"), (0, 100))
  for h in ["1", "1,2,3", "-1,2", "1, 2", "2147483648,0"] {
    assert_true(
      try {
        ignore(heartbeat_pair(h))
        false
      } catch {
        _ => true
      },
    )
  }
}

///|
test "fake monotonic clock any incoming byte keeps peer alive" {
  let h = HeartbeatClock::new(
    { send_ms: 10, receive_ms: 20, },
    0,
    tolerance_ms=5,
  )
  assert_eq(h.poll(9), (false, false))
  assert_eq(h.poll(10), (true, false))
  h.sent_data(10)
  h.received_data(19)
  assert_eq(h.poll(25), (true, false))
  assert_eq(h.poll(44), (true, false))
  assert_eq(h.poll(45), (true, true))
  assert_true(
    try {
      ignore(h.poll(44))
      false
    } catch {
      _ => true
    },
  )
}

///|
test "public heartbeat clock retains its default 100ms tolerance" {
  let clock = HeartbeatClock::new({ send_ms: 0, receive_ms: 20, }, 0)
  assert_eq(clock.poll(120), (false, false))
  assert_eq(clock.poll(121), (false, true))
}

///|
test "client heartbeat check phase plus scheduling slack has a strict deadline" {
  for
    (period, connected) in [
      (100, b"CONNECTED\nversion:1.2\nheart-beat:100,100\n\n\x00"),
      (1000, b"CONNECTED\nversion:1.2\nheart-beat:1000,1000\n\n\x00"),
    ] {
    let c = Client::new()
    ignore(c.send(connect("localhost", heartbeat="\{period},\{period}"), 0))
    ignore(c.receive(connected, 0))
    let deadline = (2 * period + 100).to_int64()
    assert_eq(c.tick(period.to_int64()), b"\n")
    ignore(c.receive(b"", deadline - 1))
    ignore(c.tick(deadline))
    assert_eq(c.state(), Active)
    assert_true(
      try {
        ignore(c.tick(deadline + 1))
        false
      } catch {
        _ => true
      },
    )
    assert_eq(c.state(), Closed)
  }
}

///|
test "first broker keepalive after 2R resets deadline and partial bytes remain live" {
  for
    (period, connected) in [
      (100, b"CONNECTED\nversion:1.2\nheart-beat:100,100\n\n\x00"),
      (1000, b"CONNECTED\nversion:1.2\nheart-beat:1000,1000\n\n\x00"),
    ] {
    let c = Client::new()
    ignore(c.send(connect("localhost", heartbeat="\{period},\{period}"), 0))
    ignore(c.receive(connected, 0))
    let first = (2 * period + 15).to_int64()
    ignore(c.tick(first))
    assert_eq(c.state(), Active)
    ignore(c.receive(b"\n", first))
    ignore(c.receive(b"M", first + 20))
    let deadline = first + 20 + (2 * period + 100).to_int64()
    ignore(c.receive(b"", deadline - 1))
    ignore(c.tick(deadline))
    assert_eq(c.state(), Active)
    assert_true(
      try {
        ignore(c.tick(deadline + 1))
        false
      } catch {
        _ => true
      },
    )
    assert_eq(c.state(), Closed)
  }
}

///|
test "client heartbeat disabled receive and maximum negotiated interval stay bounded" {
  let disabled = Client::new()
  ignore(disabled.send(connect("localhost", heartbeat="0,1000"), 0))
  ignore(
    disabled.receive(b"CONNECTED\nversion:1.2\nheart-beat:0,1000\n\n\x00", 0),
  )
  assert_eq(disabled.tick(100000), b"")
  assert_eq(disabled.state(), Active)
  let large = Client::new()
  ignore(large.send(connect("localhost", heartbeat="2147483647,2147483647"), 0))
  ignore(
    large.receive(
      b"CONNECTED\nversion:1.2\nheart-beat:2147483647,2147483647\n\n\x00", 0,
    ),
  )
  ignore(large.tick(4294967294L))
  assert_eq(large.state(), Active)
  assert_true(
    try {
      ignore(large.tick(4294967295L))
      false
    } catch {
      _ => true
    },
  )
  assert_eq(large.state(), Closed)
}
