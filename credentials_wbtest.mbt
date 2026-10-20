///|
test "CONNECT optional credentials preserve omission and explicit empty values" {
  assert_eq(connect("vhost").header("login"), None)
  let frame = connect("vhost", login="name:with\\slash", passcode="")
  assert_eq(frame.header("host"), Some("vhost"))
  assert_eq(frame.header("login"), Some("name:with\\slash"))
  assert_eq(frame.header("passcode"), Some(""))
  let wire = @utf8.decode(encode(frame))
  assert_true(wire.contains("login:name:with\\slash\npasscode:\n"))
  for version in [V10, V11, V12] {
    let frame = connect_versions(
      "vhost",
      [version],
      login="",
      passcode="local-test-only",
    )
    assert_eq(frame.header("login"), Some(""))
    assert_eq(frame.header("passcode"), Some("local-test-only"))
    assert_eq(
      frame.header("host"),
      if version == V10 {
        None
      } else {
        Some("vhost")
      },
    )
    ignore(encode_versioned(frame, version))
  }
}

///|
test "CONNECT encoding rejects header injection without escaping credentials" {
  for value in ["name\nextra:header", "name\u0000suffix", "name\r"] {
    for
      frame in [
        connect("host", login=value),
        connect("host", passcode=value),
        connect(value),
      ] {
      assert_true(
        try {
          ignore(encode(frame))
          false
        } catch {
          Invalid(_) => true
        },
      )
    }
  }
}
