///|
test "header escaping UTF8 and spaces" {
  let s = " 中文 :\r\n\\ "
  assert_eq(unescape_header(escape_header(s)), s)
  assert_eq(escape_header(":"), "\\c")
  assert_eq(unescape_header(" leading "), " leading ")
}

///|
test "undefined and trailing escapes rejected" {
  for s in ["\\t", "\\", "raw:colon", "raw\r", "raw\u0000"] {
    let bad = try {
      ignore(unescape_header(s))
      false
    } catch {
      _ => true
    }
    assert_true(bad)
  }
}

///|
test "binary encoding counts octets and validates lengths" {
  assert_eq(
    encode(Frame::new("SEND", [], body=b"a\x00b")),
    b"SEND\ncontent-length:3\n\na\x00b\x00",
  )
  assert_eq(
    encode(Frame::new("CONNECT", [("login", "a\\b:c")])),
    b"CONNECT\nlogin:a\\b:c\n\n\x00",
  )
  for
    f in [
      Frame::new("ACK", [], body=b"x"),
      Frame::new("SEND", [("content-length", "-1")]),
      Frame::new("SEND", [("content-length", "2")], body=b"x"),
    ] {
    assert_true(
      try {
        ignore(encode(f))
        false
      } catch {
        _ => true
      },
    )
  }
}
