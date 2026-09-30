fn slice(b : Bytes, start : Int, end : Int) -> Bytes { Bytes::from_array(b.to_array()[start:end].to_owned()) }

test "all two-way and three-way splits including UTF8 CRLF NUL and concatenation" {
  let wire = b"\r\nSEND\r\ndestination:a\r\nx:a\\cb\r\ncontent-length:4\r\n\r\na\x00\xffb\x00RECEIPT\nreceipt-id:r\n\n\x00"
  let expected : Array[WireEvent] = [Heartbeat, Frame(Frame::new("SEND", [("destination", "a"), ("x", "a:b"), ("content-length", "4")], body=b"a\x00\xffb")), Frame(Frame::new("RECEIPT", [("receipt-id", "r")]))]
  for i = 0; i <= wire.length(); i = i+1 {
    for j = i; j <= wire.length(); j = j+1 {
      let d = Decoder::new()
      let events = d.feed(slice(wire, 0, i))
      for e in d.feed(slice(wire, i, j)) { events.push(e) }
      for e in d.feed(slice(wire, j, wire.length())) { events.push(e) }
      d.end()
      assert_eq(events, expected)
    }
  }
}

test "byte-at-a-time decoder preserves duplicate header first value and spaces" {
  let d = Decoder::new()
  let events = []
  for b in b"SEND\nx: first \nx:second\n\n\xc3\xa9\x00\n" { for e in d.feed(Bytes::from_array([b])) { events.push(e) } }
  assert_eq(events.length(), 2)
  match events[0] {
    Frame(f) => { assert_eq(f.header("x"), Some(" first ")); assert_eq(f.body, b"\xc3\xa9") }
    _ => fail("expected frame")
  }
  d.end()
}

test "invalid wire vectors poison and EOF detects truncation" {
  for wire in [b"BAD\n\n\x00", b"SEND\na\\t:v\n\n\x00", b"SEND\na:v\\\n\n\x00", b"SEND\na:b:c\n\n\x00", b"SEND\ncontent-length:-1\n\n\x00", b"SEND\ncontent-length:2147483648\n\n\x00", b"SEND\ncontent-length:1\n\nab\x00", b"SEND\na\rX:v\n\n\x00", b"SEND\n\xff:v\n\n\x00", b"ACK\n\nx\x00", b"SEND\na\x00:v\n\n\x00"] {
    let d = Decoder::new()
    assert_true(try { ignore(d.feed(wire)); false } catch { _ => true })
    assert_true(try { ignore(d.feed(b"\n")); false } catch { _ => true })
  }
  for wire in [b"S", b"\r", b"SEND\n", b"SEND\n\na", b"SEND\ncontent-length:3\n\na\x00", b"SEND\ncontent-length:0\n\n"] {
    let d = Decoder::new()
    ignore(d.feed(wire))
    assert_true(try { d.end(); false } catch { _ => true })
  }
}

test "resource limits reject while streaming exact boundaries pass" {
  let limit = { max_line: 4, max_headers: 1, max_body: 2, max_events: 1 }
  for wire in [b"SENDS", b"SEND\nx:a\ny:b\n", b"SEND\n\nabc", b"\n\n"] {
    let d = Decoder::new(limits=limit)
    assert_true(try { ignore(d.feed(wire)); false } catch { _ => true })
  }
  let d = Decoder::new(limits=limit)
  assert_eq(d.feed(b"SEND\nx:a\n\nab\x00").length(), 1)
  d.end()
  assert_true(try { ignore(Decoder::new(limits={ ..limit, max_events: 0 })); false } catch { _ => true })
}

test "zero and duplicate content length and CONNECT exception" {
  let d = Decoder::new()
  let e = d.feed(b"SEND\ncontent-length:0\ncontent-length:3\n\n\x00CONNECT\nlogin:a\\t:b\n\n\x00")
  assert_eq(e.length(), 2)
  match e[1] { Frame(f) => assert_eq(f.header("login"), Some("a\\t:b")); _ => fail("frame") }
}
