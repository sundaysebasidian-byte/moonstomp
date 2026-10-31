///|
test "raw header diagnostics do not misidentify the command" {
  for command in ["SEND", "CONNECT", "CONNECTED", "SUBSCRIBE"] {
    for
      pair in [
        ("bad", "x\u0000y"),
        ("bad\u0000key", "x"),
        ("destination", "x\u0000y"),
      ] {
      let message = try {
        ignore(encode_versioned(Frame::new(command, [pair]), V10))
        "unexpected success"
      } catch {
        Invalid(reason) => reason
      }
      assert_eq(message, "invalid raw header")
    }
  }
  assert_eq(
    encode_versioned(Frame::new("SEND", [("destination", "/queue/test")]), V10),
    b"SEND\ndestination:/queue/test\n\n\x00",
  )
}
