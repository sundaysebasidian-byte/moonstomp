///|
test "audit20 R04 heartbeat cartesian and near Int64 ceiling" {
  for cx in [0, 1, 17, 2147483647] {
    for cy in [0, 1, 17, 2147483647] {
      for sx in [0, 1, 17, 2147483647] {
        for sy in [0, 1, 17, 2147483647] {
          let p = negotiate_heartbeat(cx, cy, sx, sy)
          assert_eq(
            p.send_ms,
            if cx == 0 || sy == 0 {
              0
            } else {
              Int32::max(cx, sy)
            },
          )
          assert_eq(
            p.receive_ms,
            if cy == 0 || sx == 0 {
              0
            } else {
              Int32::max(cy, sx)
            },
          )
        }
      }
    }
  }
  let top = 9223372036854775807L
  for gap in [1L, 17L, 1000L] {
    let h = HeartbeatClock::new(
      { send_ms: 1, receive_ms: 1, },
      top - gap,
      tolerance_ms=0,
    )
    assert_eq(h.poll(top), (true, gap > 1))
    h.received_data(top)
    h.sent_data(top)
    assert_eq(h.poll(top), (false, false))
    assert_true(
      try {
        ignore(h.poll(top - 1))
        false
      } catch {
        _ => true
      },
    )
  }
}
