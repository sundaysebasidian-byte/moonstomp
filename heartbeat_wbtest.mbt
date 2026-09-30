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
