test "ordered duplicate headers use first and retain history" {
  let frame = Frame::new("SEND", [("destination", "a"), ("destination", "b")])
  assert_eq(frame.header("destination"), Some("a"))
  assert_eq(frame.headers.length(), 2)
  assert_eq(frame.header("missing"), None)
}
