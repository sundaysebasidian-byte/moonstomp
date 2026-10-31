///|
test "audit20 R07 no receipt disconnect and EOF terminal contract" {
  for v in [V10, V11, V12] {
    let c = review_client(v)
    ignore(c.send(begin_transaction("T"), 0))
    let wire = c.send(Frame::new("DISCONNECT", []), 0)
    assert_eq(wire, b"DISCONNECT\n\n\x00")
    assert_eq(c.state(), Closed)
    assert_eq(c.transactions.length(), 0)
    assert_eq(c.tick(9223372036854775807L), b"")
    assert_eq(c.tick(0), b"")
    assert_eq(c.version(), Some(v))
    assert_true(
      try {
        ignore(c.send(send_message("q", b"x"), 0))
        false
      } catch {
        _ => true
      },
    )
    let clean = review_client(v)
    clean.end()
    assert_eq(clean.state(), Closed)
    assert_true(
      try {
        clean.end()
        false
      } catch {
        _ => true
      },
    )
    for tail in [b"M", b"MESSAGE\n", b"\r"] {
      let partial = review_client(v)
      ignore(partial.receive(tail, 0))
      assert_true(
        try {
          partial.end()
          false
        } catch {
          _ => true
        },
      )
      assert_eq(partial.state(), Closed)
      assert_eq(partial.decoder.body.length(), 0)
      assert_eq(partial.decoder.line.length(), 0)
    }
  }
}
