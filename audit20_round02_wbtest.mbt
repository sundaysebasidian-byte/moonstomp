///|
test "audit20 R02 Unicode header widths escapes and legacy CR matrix" {
  for version in [V10, V11, V12] {
    for text in ["é", "界", "😀", "\u{10ffff}", "x\\y", " a:b "] {
      let wire = encode_versioned(Frame::new("SEND", [("x", text)]), version)
      for cut = 0; cut <= wire.length(); cut = cut + 1 {
        let d = Decoder::new(version~)
        let all = d.feed(slice(wire, 0, cut))
        for e in d.feed(slice(wire, cut, wire.length())) {
          all.push(e)
        }
        assert_eq(all, [Frame(Frame::new("SEND", [("x", text)]))])
        d.end()
      }
    }
    let wire = encode_versioned(Frame::new("SEND", [("x", "a\rb")]), version)
    let d = Decoder::new(version~)
    assert_eq(d.feed(wire), [Frame(Frame::new("SEND", [("x", "a\rb")]))])
  }
  for bytes in [b"\xc0\x80", b"\xed\xa0\x80", b"\xf4\x90\x80\x80", b"\x80"] {
    for cut = 0; cut <= bytes.length(); cut = cut + 1 {
      let d = Decoder::new()
      ignore(d.feed(b"SEND\nx:"))
      ignore(d.feed(slice(bytes, 0, cut)))
      ignore(d.feed(slice(bytes, cut, bytes.length())))
      assert_true(
        try {
          ignore(d.feed(b"\n\n\x00"))
          false
        } catch {
          _ => true
        },
      )
      assert_true(d.failed)
      assert_eq(d.line.length(), 0)
    }
  }
}
