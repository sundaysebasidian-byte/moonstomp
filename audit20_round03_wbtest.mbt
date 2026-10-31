///|
test "audit20 R03 repeated header first value case and prewrite atomicity" {
  for v in [V10, V11, V12] {
    let c = review_client(v)
    let bad = Frame::new("SEND", [
      ("destination", ""),
      ("destination", "/valid"),
      ("receipt", "r"),
    ])
    assert_true(
      try {
        ignore(c.send(bad, 0))
        false
      } catch {
        _ => true
      },
    )
    assert_eq(c.pending_receipts(), 0)
    assert_eq(c.state(), Active)
    for value in ["0", "2", "-1", "1 "] {
      let bad = Frame::new(
        "SEND",
        [("destination", "/q"), ("content-length", value), ("receipt", "r")],
        body=b"x",
      )
      assert_true(
        try {
          ignore(c.send(bad, 0))
          false
        } catch {
          _ => true
        },
      )
      assert_eq(c.pending_receipts(), 0)
    }
    let good = Frame::new(
      "SEND",
      [
        ("destination", "/first"),
        ("destination", "/second"),
        ("Destination", "/case"),
        ("content-length", "1"),
        ("content-length", "0"),
        ("receipt", "r"),
      ],
      body=b"x",
    )
    let encoded = c.send(good, 0)
    let d = Decoder::new(version=v)
    assert_eq(d.feed(encoded), [Frame(good)])
    assert_eq(good.header("destination"), Some("/first"))
    assert_eq(good.header("Destination"), Some("/case"))
    assert_eq(c.pending_receipts(), 1)
  }
}
