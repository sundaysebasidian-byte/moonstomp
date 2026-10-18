// Offline walkthrough of STOMP 1.0 / 1.1 / 1.2 behaviour. The server frames are
// supplied by this example to show the API and the version differences; this is
// not broker evidence (see docs/verified-multiversion-20261015.zh-CN.md for the
// separate Go <-> Artemis <-> MoonBit interop record).

///|
fn text(b : Bytes) -> String {
  let mut out = ""
  for i = 0; i < b.length(); i = i + 1 {
    let c = b[i].to_int()
    out = out +
      (if c == 10 {
        "\\n"
      } else if c == 0 {
        "\\0"
      } else {
        c.unsafe_to_char().to_string()
      })
  }
  out
}

///|
/// One reliable-delivery round: subscribe -> MESSAGE -> ACK -> SEND with
/// receipt -> RECEIPT -> DISCONNECT -> RECEIPT -> Closed.
fn session(
  version : @stomp.Version,
  connected : Bytes,
  message : Bytes,
) -> Unit raise {
  let c = @stomp.Client::new()
  // Offer every version; the broker's CONNECTED frame decides.
  let hello = c.send(@stomp.connect_versions("localhost", [V12, V11, V10]), 0)
  println("[\{version.wire()}] CONNECT  -> \{text(hello)}")
  ignore(c.receive(connected, 1))
  assert_eq(c.version(), Some(version))
  println(
    "[\{version.wire()}] negotiated version = \{c.version().unwrap().wire()}",
  )
  // 1.0 has no client-individual and does not require a subscription id.
  let ack_mode = if version == V10 { "client" } else { "client-individual" }
  let sub = @stomp.subscribe_versioned(
    version,
    "/queue/jobs",
    id="s1",
    ack=ack_mode,
  )
  ignore(c.send(sub, 2))
  let events = c.receive(message, 3)
  guard events is [Message(frame)] else { abort("expected one MESSAGE") }
  // ACK headers are version specific; acknowledge_message builds the right one.
  let ack = @stomp.acknowledge_message(version, frame)
  println("[\{version.wire()}] ACK      -> \{text(c.send(ack, 4))}")
  assert_eq(c.pending_deliveries(), 0)
  ignore(c.send(@stomp.send_message("/queue/jobs", b"done", receipt="r1"), 5))
  assert_eq(c.pending_receipts(), 1)
  ignore(c.receive(b"RECEIPT\nreceipt-id:r1\n\n\x00", 6))
  assert_eq(c.pending_receipts(), 0)
  println("[\{version.wire()}] receipt r1 consumed, pending_receipts = 0")
  ignore(c.send(@stomp.disconnect("bye"), 7))
  ignore(c.receive(b"RECEIPT\nreceipt-id:bye\n\n\x00", 8))
  assert_true(c.state() is Closed)
  println("[\{version.wire()}] DISCONNECT receipt consumed, state = Closed")
}

///|
fn rejected(label : String, f : () -> Unit raise @stomp.ProtocolError) -> Unit {
  try f() catch {
    @stomp.Invalid(why) => println("rejected  \{label}: \{why}")
  } noraise {
    _ => abort("expected rejection: \{label}")
  }
}

///|
fn main {
  try {
    session(
      V12,
      b"CONNECTED\nversion:1.2\n\n\x00",
      b"MESSAGE\nsubscription:s1\nmessage-id:m1\ndestination:/queue/jobs\nack:a1\ncontent-length:3\n\nA\x00B\x00",
    )
    session(
      V11,
      b"CONNECTED\nversion:1.1\n\n\x00",
      b"MESSAGE\nsubscription:s1\nmessage-id:m1\ndestination:/queue/jobs\nack:a1\n\nx\x00",
    )
    // A 1.0 broker sends no version header at all.
    session(
      V10,
      b"CONNECTED\nsession:legacy\n\n\x00",
      b"MESSAGE\nsubscription:s1\nmessage-id:m1\ndestination:/queue/jobs\n\nx\x00",
    )
  } catch {
    e => abort("session failed: \{e}")
  }
  println("--- explicit boundaries ---")
  rejected("NACK under 1.0", fn() raise @stomp.ProtocolError {
    let m = @stomp.Frame::new("MESSAGE", [("message-id", "m1")])
    ignore(@stomp.acknowledge_message(V10, m, negative=true))
  })
  rejected("client-individual under 1.0", fn() raise @stomp.ProtocolError {
    ignore(
      @stomp.subscribe_versioned(V10, "/q", id="s", ack="client-individual"),
    )
  })
  rejected("1.1/1.2 subscription without id", fn() raise @stomp.ProtocolError {
    ignore(@stomp.subscribe_versioned(V12, "/q"))
  })
  rejected("heart-beat offered with 1.0 only", fn() raise @stomp.ProtocolError {
    ignore(@stomp.connect_versions("h", [V10], heartbeat="1000,1000"))
  })
  rejected("unsupported version 2.0", fn() raise @stomp.ProtocolError {
    ignore(@stomp.parse_version("2.0"))
  })
  rejected("server answers with a version not offered", fn() raise @stomp.ProtocolError {
    let c = @stomp.Client::new()
    ignore(c.send(@stomp.connect_versions("h", [V12]), 0))
    ignore(c.receive(b"CONNECTED\nversion:1.1\n\n\x00", 1))
  })
}
