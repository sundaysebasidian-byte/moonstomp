///|
test "audit20 R06 handshake coalesced events retain order or fail closed" {
  for v in [V10, V11, V12] {
    let prefix = if v == V10 {
      "CONNECTED\n\n\u0000"
    } else {
      "CONNECTED\nversion:" + v.wire() + "\n\n\u0000"
    }
    for
      tail in [
        "\n", "ERROR\nmessage:closed\n\n\u0000", "RECEIPT\nreceipt-id:unsolicited\n\n\u0000",
        "MESSAGE\ndestination:q\nmessage-id:m\nsubscription:x\n\n\u0000",
      ] {
      let c = Client::new()
      ignore(c.send(connect_versions("localhost", [v]), 0))
      let wire = @utf8.encode(prefix + tail)
      if tail == "\n" {
        assert_eq(c.receive(wire, 1), [Connected, Heartbeat])
        assert_eq(c.state(), Active)
      } else if tail.has_prefix("ERROR") {
        let events = c.receive(wire, 1)
        assert_eq(events.length(), 2)
        assert_eq(events[0], Connected)
        assert_eq(c.state(), Closed)
      } else {
        assert_true(
          try {
            ignore(c.receive(wire, 1))
            false
          } catch {
            _ => true
          },
        )
        assert_eq(c.state(), Closed)
      }
    }
  }
  for v in [V10, V11] {
    let c = Client::new()
    ignore(c.send(connect_versions("localhost", [v]), 0))
    let wire = @utf8.encode(
      "CONNECTED\r\nversion:" + v.wire() + "\r\n\r\n\u0000",
    )
    assert_true(
      try {
        ignore(c.receive(wire, 1))
        false
      } catch {
        _ => true
      },
    )
    assert_eq(c.state(), Closed)
  }
}
