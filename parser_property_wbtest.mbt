///|
/// Generated wire uses fixed, independently written STOMP header bytes.
/// Expected decoded frames are assembled directly, not by calling encode().
test "bounded generated binary frames retain ordered headers across every split" {
  let limits = Limits::new(max_line=128, max_headers=8, max_body=64, max_events=8)
  for run = 0; run < 64; run = run + 1 {
    let command = ["SEND", "MESSAGE", "ERROR"][run % 3]
    let eol = if run % 2 == 0 { "\n" } else { "\r\n" }
    let size = run
    let body = Bytes::from_array(
      Array::makei(size, i => ((i * 97 + run * 13) % 256).to_byte()),
    )
    let head = command + eol + "x\\c标签: value\\c\\n\\r\\\\ " + eol +
      "x:first" + eol + "x:second" + eol + "content-length:" +
      size.to_string() + eol + "content-length:0" + eol + eol
    let bytes = @utf8.encode("\r\n" + head).to_array()
    for b in body { bytes.push(b) }
    for b in b"\x00\nACK\nid:a\n\n\x00" { bytes.push(b) }
    let wire = Bytes::from_array(bytes)
    let expected : Array[WireEvent] = [
      Heartbeat,
      Frame(Frame::new(command, [
        ("x:标签", " value:\n\r\\ "), ("x", "first"), ("x", "second"),
        ("content-length", size.to_string()), ("content-length", "0"),
      ], body~)),
      Heartbeat,
      Frame(Frame::new("ACK", [("id", "a")])),
    ]
    for cut = 0; cut <= wire.length(); cut = cut + 1 {
      let d = Decoder::new(limits~)
      let actual = d.feed(slice(wire, 0, cut))
      for event in d.feed(slice(wire, cut, wire.length())) { actual.push(event) }
      d.end()
      assert_eq(actual, expected)
    }
    // Seeded multipart partitions also include empty chunks and split UTF-8.
    for trial = 1; trial <= 8; trial = trial + 1 {
      let d = Decoder::new(limits~)
      let actual = []
      let mut seed = (run + 1) * trial
      let mut pos = 0
      while pos < wire.length() {
        assert_eq(d.feed(b"").length(), 0)
        seed = (seed * 17 + 31) % 997
        let end = Int::min(wire.length(), pos + seed % 13 + 1)
        for event in d.feed(slice(wire, pos, end)) { actual.push(event) }
        pos = end
      }
      d.end()
      assert_eq(actual, expected)
    }
  }
}

///|
test "malformed corpus rejects at every split and releases owned buffers" {
  let vectors = [
    b"SEND\nx:\xc0\xaf\n\n\x00", // overlong UTF-8
    b"SEND\nx:\xed\xa0\x80\n\n\x00", // surrogate UTF-8
    b"SEND\nx:\xf4\x90\x80\x80\n\n\x00", // beyond Unicode maximum
    b"SEND\nx:\xe4\xb8\n\n\x00", // truncated UTF-8 character
    b"SEND\nx:a\\u\n\n\x00",
    b"SEND\nx:a\\\n\n\x00",
    b"SEND\nx:a\rb\n\n\x00",
    b"SEND\ncontent-length: 1\n\na\x00",
    b"SEND\ncontent-length:1 \n\na\x00",
    b"SEND\ncontent-length:+1\n\na\x00",
    b"SEND\ncontent-length:\xef\xbc\x91\n\na\x00",
    b"SEND\ncontent-length:17\n\n",
    b"SEND\ncontent-length:0\n\nx\x00",
    b"SEND\ncontent-length:1\n\naX",
    b"SEND\ncontent-length:2\n\na\x00",
    b"SEND\nx:v\n\npartial",
    b"ACK\ncontent-length:1\n\na\x00",
    b"SEND\nx\x00:v\n\n\x00",
    b"\r",
  ]
  let limits = Limits::new(max_line=64, max_headers=4, max_body=16)
  for wire in vectors {
    for cut = 0; cut <= wire.length(); cut = cut + 1 {
      let d = Decoder::new(limits~)
      let rejected = try {
        ignore(d.feed(slice(wire, 0, cut)))
        ignore(d.feed(slice(wire, cut, wire.length())))
        d.end()
        false
      } catch { _ => true }
      assert_true(rejected)
      assert_true(d.failed)
      assert_eq(d.line.length(), 0)
      assert_eq(d.headers.length(), 0)
      assert_eq(d.body.length(), 0)
      assert_true(try { ignore(d.feed(b"")); false } catch { _ => true })
      assert_true(try { ignore(d.feed(b"SEND\n\n\x00")); false } catch { _ => true })
    }
  }
}

///|
test "generated header escapes round trip and cannot produce raw delimiters" {
  let alphabet = ["a", " ", ":", "\n", "\r", "\\", "中", "😀"]
  for run = 0; run < 512; run = run + 1 {
    let mut seed = run
    let mut value = ""
    for i = 0; i < 8; i = i + 1 {
      value = value + alphabet[seed % 8]
      seed = (seed * 17 + 31) % 997
    }
    let escaped = escape_header(value)
    for c in escaped { assert_true(c != '\r' && c != '\n' && c != ':') }
    assert_eq(unescape_header(escaped), value)
  }
  assert_true(try { ignore(escape_header("x\u0000y")); false } catch { _ => true })
  for bad in ["\\t", "\\0", "\\u0000", "trailing\\", ":", "\r", "\n", "\u0000"] {
    assert_true(try { ignore(unescape_header(bad)); false } catch { _ => true })
  }
}

///|
test "zero-capacity bodies header counts and per-feed events have exact boundaries" {
  let d = Decoder::new(limits=Limits::new(max_line=5, max_headers=0, max_body=0, max_events=1))
  assert_eq(d.feed(b"SEND\r\n\r\n\x00").length(), 1)
  d.end()
  for wire in [b"SEND\n\na", b"SEND\nx:v\n", b"\n\n", b"SEND\n\n\x00ACK\n\n\x00"] {
    let d = Decoder::new(limits=Limits::new(max_line=5, max_headers=0, max_body=0, max_events=1))
    assert_true(try { ignore(d.feed(wire)); false } catch { _ => true })
    assert_true(d.failed)
    assert_eq(d.body.length(), 0)
    assert_eq(d.headers.length(), 0)
  }
  let d = Decoder::new(limits=Limits::new(max_events=1))
  assert_eq(d.feed(b"\n").length(), 1)
  assert_eq(d.feed(b"\r\n").length(), 1)
  d.end()
}
