///|
test "audit20 R01 custom zero and exact decoder budgets across feeds" {
  for version in [V10, V11, V12] {
    let d = Decoder::new(
      version~,
      limits=Limits::new(max_line=4, max_headers=0, max_body=0, max_events=1),
    )
    assert_eq(d.feed(b"SEND\n\n\x00").length(), 1)
    assert_eq(d.feed(b"\n").length(), 1)
    assert_eq(d.feed(b"\n").length(), 1)
    d.end()
    for
      wire in [
        b"SENDX\n\n\x00", b"SEND\nx:y\n\n\x00", b"SEND\n\nx\x00", b"\n\n",
      ] {
      let d = Decoder::new(
        version~,
        limits=Limits::new(max_line=4, max_headers=0, max_body=0, max_events=1),
      )
      assert_true(
        try {
          ignore(d.feed(wire))
          false
        } catch {
          _ => true
        },
      )
      assert_true(d.failed)
      assert_eq(d.line.length(), 0)
      assert_eq(d.headers.length(), 0)
      assert_eq(d.body.length(), 0)
    }
    for cut = 0; cut <= 4; cut = cut + 1 {
      let d = Decoder::new(
        version~,
        limits=Limits::new(max_line=4, max_headers=1, max_body=1, max_events=1),
      )
      let first = b"SEND"
      ignore(d.feed(slice(first, 0, cut)))
      ignore(d.feed(slice(first, cut, 4)))
      assert_eq(d.feed(b"\nx:y\n\nz\x00").length(), 1)
      d.end()
    }
  }
}
