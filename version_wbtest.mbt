///|
test "legacy constructors retain 1.2 wire behavior" {
  assert_eq(connect("local").header("accept-version"), Some("1.2"))
  let frame = Frame::new("SEND", [("destination", "a:b\\c")], body=b"x\x00y")
  assert_eq(encode(frame), encode_versioned(frame, V12))
}

///|
test "versioned headers preserve 1.0 literals and 1.1 escapes" {
  let frame = Frame::new("MESSAGE", [("path", "a:b\\c")])
  for version in [V10, V11, V12] {
    let decoder = Decoder::new(version~)
    let events = decoder.feed(encode_versioned(frame, version))
    assert_eq(events, [WireEvent::Frame(frame)])
    decoder.end()
  }
  assert_eq(unescape_versioned("x\\n\\c\\\\", V11), "x\n:\\")
  assert_true(try { ignore(unescape_versioned("\\r", V11)); false } catch { _ => true })
  assert_eq(unescape_versioned("\\r", V12), "\r")
  assert_eq(escape_versioned("\r", V11), "\r")
}

///|
test "only 1.2 accepts CRLF frame delimiters" {
  for version in [V10, V11] {
    let decoder = Decoder::new(version~)
    assert_true(try { ignore(decoder.feed(b"MESSAGE\r\n\r\n\x00")); false } catch { _ => true })
    assert_true(try { ignore(decoder.feed(b"MESSAGE\n\n\x00")); false } catch { _ => true })
  }
  let decoder = Decoder::new(version=V12)
  assert_eq(decoder.feed(b"MESSAGE\r\n\r\n\x00"), [WireEvent::Frame(Frame::new("MESSAGE", []))])
}

///|
test "CONNECTED selects 1.0 before the next frame in every chunk partition" {
  let bytes = b"CONNECTED\nsession:legacy\n\n\x00MESSAGE\npath:a\\r:b\n\nbody\x00"
  for boundary = 0; boundary <= bytes.length(); boundary = boundary + 1 {
    let decoder = Decoder::new()
    decoder.expect_versions([V10, V11, V12])
    let events = decoder.feed(bytes[:boundary].to_owned())
    for event in decoder.feed(bytes[boundary:].to_owned()) { events.push(event) }
    assert_eq(events.length(), 2)
    match events[1] {
      WireEvent::Frame(frame) => assert_eq(frame.header("path"), Some("a\\r:b"))
      _ => assert_true(false)
    }
    decoder.end()
  }
}

///|
test "CONNECTED selects 1.1 before rejecting a following 1.2-only escape" {
  let decoder = Decoder::new()
  decoder.expect_versions([V10, V11, V12])
  assert_true(try {
    ignore(decoder.feed(b"CONNECTED\nversion:1.1\n\n\x00MESSAGE\npath:a\\r\n\n\x00"))
    false
  } catch { _ => true })
  assert_true(try { ignore(decoder.feed(b"\n")); false } catch { _ => true })
}

///|
test "negotiation rejects unoffered and unsupported selections" {
  for selection in [b"CONNECTED\nversion:1.1\n\n\x00", b"CONNECTED\n\n\x00", b"CONNECTED\nversion:2.0\n\n\x00"] {
    let client = Client::new()
    ignore(client.send(connect("local"), 0))
    assert_true(try { ignore(client.receive(selection, 0)); false } catch { _ => true })
    assert_eq(client.state(), Closed)
  }
}

///|
test "1.0 destination subscription ACK and receipt-fenced unsubscribe" {
  let client = Client::new()
  assert_eq(client.send(connect_versions("", [V10]), 0), b"CONNECT\n\n\x00")
  ignore(client.receive(b"CONNECTED\nsession:legacy\n\n\x00", 0))
  assert_eq(client.version(), Some(V10))
  ignore(client.send(subscribe_versioned(V10, "tasks", ack="client"), 0))
  let message = Frame::new("MESSAGE", [("destination", "tasks"), ("message-id", "m\\1")], body=b"job")
  ignore(client.receive(encode_versioned(message, V10), 0))
  assert_eq(client.pending_deliveries(), 1)
  assert_eq(client.send(acknowledge_message(V10, message), 0), b"ACK\nmessage-id:m\\1\n\n\x00")
  assert_eq(client.pending_deliveries(), 0)
  assert_eq(client.tick(100000), b"")
  ignore(client.send(Frame::new("UNSUBSCRIBE", [("destination", "tasks"), ("receipt", "fence")]), 100000))
  ignore(client.receive(b"MESSAGE\ndestination:tasks\nmessage-id:last\n\n\x00", 100000))
  ignore(client.receive(b"RECEIPT\nreceipt-id:fence\n\n\x00", 100000))
  assert_eq(client.pending_deliveries(), 1)
  ignore(client.send(acknowledge_message(V10, Frame::new("MESSAGE", [("message-id", "last")])), 100000))
  assert_eq(client.pending_deliveries(), 0)
}

///|
test "1.0 optional subscription id is separate from destination key" {
  let client = Client::new()
  ignore(client.send(connect_versions("", [V10]), 0))
  ignore(client.receive(b"CONNECTED\n\n\x00", 0))
  ignore(client.send(subscribe_versioned(V10, "tasks", id="s", ack="client"), 0))
  ignore(client.receive(b"MESSAGE\ndestination:tasks\nsubscription:s\nmessage-id:m\n\n\x00", 0))
  ignore(client.send(acknowledge_message(V10, Frame::new("MESSAGE", [("message-id", "m")])), 0))
  ignore(client.send(unsubscribe("s"), 0))
  assert_eq(client.pending_deliveries(), 0)
}

///|
test "1.0 rejects NACK individual mode and active heartbeat intent" {
  assert_true(try { ignore(connect_versions("", [V10], heartbeat="1,1")); false } catch { _ => true })
  assert_true(try { ignore(subscribe_versioned(V10, "tasks", ack="client-individual")); false } catch { _ => true })
  assert_true(try { ignore(encode_versioned(Frame::new("NACK", [("message-id", "m")]), V10)); false } catch { _ => true })
}

///|
test "1.1 ACK must name the delivered message and subscription" {
  let client = Client::new()
  ignore(client.send(connect_versions("local", [V11]), 0))
  ignore(client.receive(b"CONNECTED\nversion:1.1\n\n\x00", 0))
  ignore(client.send(subscribe_versioned(V11, "tasks", id="s", ack="client-individual"), 0))
  let message = Frame::new("MESSAGE", [("destination", "tasks"), ("subscription", "s"), ("message-id", "m")])
  ignore(client.receive(encode_versioned(message, V11), 0))
  assert_true(try { ignore(client.send(acknowledge("m"), 0)); false } catch { _ => true })
  assert_true(try { ignore(client.send(Frame::new("ACK", [("message-id", "m"), ("subscription", "other")]), 0)); false } catch { _ => true })
  assert_eq(client.pending_deliveries(), 1)
  assert_eq(client.send(acknowledge_message(V11, message, negative=true), 0), b"NACK\nmessage-id:m\nsubscription:s\n\n\x00")
  assert_eq(client.pending_deliveries(), 0)
}

///|
test "1.1 cumulative transaction abort restores deliveries" {
  let client = Client::new()
  ignore(client.send(connect_versions("local", [V10, V11, V12]), 0))
  ignore(client.receive(b"CONNECTED\nversion:1.1\n\n\x00", 0))
  ignore(client.send(subscribe_versioned(V11, "tasks", id="s", ack="client"), 0))
  ignore(client.receive(b"MESSAGE\ndestination:tasks\nsubscription:s\nmessage-id:a\n\n\x00MESSAGE\ndestination:tasks\nsubscription:s\nmessage-id:b\n\n\x00", 0))
  ignore(client.send(begin_transaction("t"), 0))
  let last = Frame::new("MESSAGE", [("message-id", "b"), ("subscription", "s")])
  ignore(client.send(acknowledge_message(V11, last, transaction="t"), 0))
  assert_eq(client.pending_deliveries(), 2)
  ignore(client.send(finish_transaction("t", commit=false), 0))
  ignore(client.send(acknowledge_message(V11, last), 0))
  assert_eq(client.pending_deliveries(), 0)
}

///|
test "legacy handshake cannot silently accept 1.2-only EOLs" {
  for version in [V10, V11] {
    let decoder = Decoder::new()
    decoder.expect_versions([version])
    let wire = if version == V10 {
      b"CONNECTED\r\nsession:legacy\r\n\r\n\x00"
    } else {
      b"CONNECTED\r\nversion:1.1\r\n\r\n\x00"
    }
    assert_true(try { ignore(decoder.feed(wire)); false } catch { _ => true })
  }
}

///|
test "1.0 idless overlap is rejected atomically in both insertion orders" {
  for first_id in ["", "s"] {
    let client = Client::new()
    ignore(client.send(connect_versions("", [V10]), 0))
    ignore(client.receive(b"CONNECTED\n\n\x00", 0))
    ignore(client.send(subscribe_versioned(V10, "tasks", id=first_id), 0))
    let second_id = if first_id == "" { "s" } else { "" }
    assert_true(try { ignore(client.send(subscribe_versioned(V10, "tasks", id=second_id), 0)); false } catch { _ => true })
    ignore(client.receive(b"MESSAGE\ndestination:tasks\nmessage-id:m\n\n\x00", 0))
    assert_eq(client.state(), Active)
  }
}

///|
test "older headers retain literal CR data including at line end" {
  for version in [V10, V11] {
    let frame = Frame::new("MESSAGE", [("mid", "a\rb"), ("tail", "a\r")])
    let decoder = Decoder::new(version~)
    assert_eq(decoder.feed(encode_versioned(frame, version)), [WireEvent::Frame(frame)])
    decoder.end()
    let negotiated = Decoder::new()
    negotiated.expect_versions([V10, V11, V12])
    let wire = if version == V10 {
      b"CONNECTED\nserver:x\r\n\n\x00MESSAGE\ntail:a\r\n\n\x00"
    } else {
      b"CONNECTED\nversion:1.1\nserver:x\r\n\n\x00MESSAGE\ntail:a\r\n\n\x00"
    }
    let events = negotiated.feed(wire)
    match events[0] {
      WireEvent::Frame(frame) => assert_eq(frame.header("server"), Some("x\r"))
      _ => assert_true(false)
    }
    match events[1] {
      WireEvent::Frame(frame) => assert_eq(frame.header("tail"), Some("a\r"))
      _ => assert_true(false)
    }
    negotiated.end()
  }
}

///|
test "1.1 heartbeat negotiation reuses send liveness and receive timeout" {
  let client = Client::new()
  ignore(client.send(connect_versions("local", [V11], heartbeat="10,20"), 0))
  ignore(client.receive(b"CONNECTED\nversion:1.1\nheart-beat:30,40\n\n\x00", 0))
  assert_eq(client.tick(39), b"")
  assert_eq(client.tick(40), b"\n")
  ignore(client.receive(b"\n", 100))
  assert_eq(client.tick(230), b"\n")
  assert_true(try { ignore(client.tick(231)); false } catch { _ => true })
  assert_eq(client.state(), Closed)
}

///|
test "pure older client CONNECT preserves literal CR header data" {
  for version in [V10, V11] {
    let client = Client::new()
    let headers = [("login", "a\rb\r")]
    if version == V11 {
      headers.push(("host", "local"))
      headers.push(("accept-version", "1.1"))
    }
    let frame = Frame::new("CONNECT", headers)
    assert_eq(client.send(frame, 0), encode_versioned(frame, version))
    assert_eq(client.state(), Connecting)
  }
}

///|
test "STOMP command allows mixed modern offers but rejects pure 1.0" {
  let client = Client::new()
  ignore(client.send(Frame::new("STOMP", [("host", "local"), ("accept-version", "1.0,1.1")]), 0))
  ignore(client.receive(b"CONNECTED\nversion:1.1\n\n\x00", 0))
  assert_eq(client.version(), Some(V11))
  let legacy = Client::new()
  assert_true(try { ignore(legacy.send(Frame::new("STOMP", [("accept-version", "1.0")]), 0)); false } catch { _ => true })
  assert_eq(legacy.state(), Fresh)
}
