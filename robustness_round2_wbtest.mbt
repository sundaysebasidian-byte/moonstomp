///|
/// Common binary framing must not depend on header-escape version semantics.
test "all versions preserve binary length NUL and coalesced frames at every split" {
  let wire = b"\nMESSAGE\nx:first\nx:second\ncontent-length:5\n\nA\x00\xff\r\n\x00\nRECEIPT\nreceipt-id:r\n\n\x00"
  let expected : Array[WireEvent] = [
    Heartbeat,
    Frame(Frame::new("MESSAGE", [("x", "first"), ("x", "second"), ("content-length", "5")], body=b"A\x00\xff\r\n")),
    Heartbeat,
    Frame(Frame::new("RECEIPT", [("receipt-id", "r")])),
  ]
  for version in [V10, V11, V12] {
    for cut = 0; cut <= wire.length(); cut = cut + 1 {
      let d = Decoder::new(version~)
      let actual = d.feed(slice(wire, 0, cut))
      for event in d.feed(slice(wire, cut, wire.length())) { actual.push(event) }
      assert_eq(actual, expected)
      d.end()
    }
    let d = Decoder::new(version~)
    let actual = []
    for byte in wire {
      assert_eq(d.feed(b""), [])
      for event in d.feed(Bytes::from_array([byte])) { actual.push(event) }
    }
    assert_eq(actual, expected)
    d.end()
  }
}

///|
test "all versions reject malformed binary framing across every split and remain poisoned" {
  let vectors = [
    b"SEND\nx:\xc0\xaf\n\n\x00",
    b"SEND\nx\x00:v\n\n\x00",
    b"SEND\nmissing-colon\n\n\x00",
    b"SEND\ncontent-length:+1\n\na\x00",
    b"SEND\ncontent-length:-1\n\na\x00",
    b"SEND\ncontent-length:0\n\na\x00",
    b"SEND\ncontent-length:1\n\naX\x00",
    b"SEND\ncontent-length:2\n\na\x00",
    b"SEND\ncontent-length:3\n\na\x00",
    b"SEND\ncontent-length:17\n\n",
    b"RECEIPT\ncontent-length:1\n\nx\x00",
  ]
  for version in [V10, V11, V12] {
    for wire in vectors {
      for cut = 0; cut <= wire.length(); cut = cut + 1 {
        let d = Decoder::new(version~, limits=Limits::new(max_body=16))
        assert_true(try {
          ignore(d.feed(slice(wire, 0, cut)))
          ignore(d.feed(slice(wire, cut, wire.length())))
          d.end()
          false
        } catch { _ => true })
        assert_true(d.failed)
        assert_eq(d.line.length(), 0)
        assert_eq(d.headers.length(), 0)
        assert_eq(d.body.length(), 0)
        assert_true(try { ignore(d.feed(b"SEND\n\n\x00")); false } catch { _ => true })
      }
    }
  }
}

///|
test "fragmented escape r is literal in 1.0 invalid in 1.1 and CR in 1.2" {
  let wire = b"MESSAGE\nx:a\\rb\n\n\x00"
  for cut = 0; cut <= wire.length(); cut = cut + 1 {
    for version in [V10, V11, V12] {
      let d = Decoder::new(version~)
      if version == V11 {
        assert_true(try {
          ignore(d.feed(slice(wire, 0, cut)))
          ignore(d.feed(slice(wire, cut, wire.length())))
          false
        } catch { _ => true })
        assert_true(d.failed)
      } else {
        let actual = d.feed(slice(wire, 0, cut))
        for event in d.feed(slice(wire, cut, wire.length())) { actual.push(event) }
        assert_eq(actual, [WireEvent::Frame(Frame::new("MESSAGE", [("x", if version == V10 { "a\\rb" } else { "a\rb" })]))])
        d.end()
      }
    }
  }
}

///|
fn round2_active(version : Version) -> Client raise ProtocolError {
  let c = Client::new()
  ignore(c.send(connect_versions("local", [version]), 0))
  ignore(c.receive(@utf8.encode("CONNECTED\nversion:" + version.wire() + "\n\n\u0000"), 0))
  c
}

///|
test "all versions disconnect receipt closes only after complete fragmented NUL" {
  let wire = b"RECEIPT\nreceipt-id:bye\n\n\x00"
  for version in [V10, V11, V12] {
    for cut = 0; cut < wire.length(); cut = cut + 1 {
      let c = round2_active(version)
      ignore(c.send(disconnect("bye"), 1))
      assert_eq(c.state(), Disconnecting)
      assert_eq(c.pending_receipts(), 1)
      assert_eq(c.receive(slice(wire, 0, cut), 2), [])
      assert_eq(c.state(), Disconnecting)
      assert_eq(c.tick(3), b"")
      assert_eq(c.receive(slice(wire, cut, wire.length()), 4), [ClientEvent::Receipt("bye")])
      assert_eq(c.state(), Closed)
      assert_eq(c.pending_receipts(), 0)
      assert_eq(c.pending_deliveries(), 0)
      assert_eq(c.tick(5), b"")
    }
  }
}

///|
test "all versions unsolicited receipts and truncated disconnect clear owned state" {
  for version in [V10, V11, V12] {
    for truncated in [false, true] {
      let c = round2_active(version)
      ignore(c.send(Frame::new("SEND", [("destination", "tasks"), ("receipt", "pending")]), 1))
      ignore(c.send(disconnect("bye"), 2))
      assert_eq(c.pending_receipts(), 2)
      assert_true(try {
        if truncated {
          ignore(c.receive(b"RECEIPT\nreceipt-id:bye\n\n", 3))
          c.end()
        } else {
          ignore(c.receive(b"RECEIPT\nreceipt-id:unknown\n\n\x00", 3))
        }
        false
      } catch { _ => true })
      assert_eq(c.state(), Closed)
      assert_eq(c.pending_receipts(), 0)
      assert_eq(c.pending_deliveries(), 0)
    }
  }
}

///|
test "modern heartbeat empty chunks do not refresh while partial frames do" {
  for version in [V11, V12] {
    let c = Client::new()
    ignore(c.send(connect_versions("local", [version], heartbeat="0,10"), 0))
    ignore(c.receive(@utf8.encode("CONNECTED\nversion:" + version.wire() + "\nheart-beat:10,0\n\n\u0000"), 0))
    ignore(c.receive(b"M", 100))
    ignore(c.receive(b"", 209))
    assert_eq(c.tick(210), b"")
    assert_true(try { ignore(c.tick(211)); false } catch { _ => true })
    assert_eq(c.state(), Closed)
    assert_eq(c.decoder.line.length(), 0)
    assert_eq(c.pending_receipts(), 0)
  }
  let legacy = round2_active(V10)
  assert_eq(legacy.tick(1000000), b"")
  assert_eq(legacy.state(), Active)
  legacy.end()
  assert_eq(legacy.state(), Closed)
}

///|
test "1.0 ignored SUBSCRIBE body stays compatible while RECEIPT body is forbidden" {
  let subscribe_wire = b"SUBSCRIBE\ndestination:tasks\ncontent-length:1\n\nx\x00"
  let legacy = Decoder::new(version=V10)
  assert_eq(legacy.feed(subscribe_wire), [WireEvent::Frame(Frame::new("SUBSCRIBE", [("destination", "tasks"), ("content-length", "1")], body=b"x"))])
  legacy.end()
  for version in [V10, V11, V12] {
    assert_true(try { ignore(encode_versioned(Frame::new("RECEIPT", [("receipt-id", "r")], body=b"x"), version)); false } catch { _ => true })
  }
}
