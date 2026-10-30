///|
/// Convenience constructors keep destinations opaque; broker semantics are external.
/// Omitted credentials stay absent; explicit empty strings are retained.
/// CONNECT values are literal. encode/send validates forbidden delimiters.
pub fn connect(
  host : String,
  heartbeat~ : String = "0,0",
  login? : String,
  passcode? : String,
) -> Frame {
  let headers = [
    ("accept-version", "1.2"),
    ("host", host),
    ("heart-beat", heartbeat),
  ]
  if login is Some(value) {
    headers.push(("login", value))
  }
  if passcode is Some(value) {
    headers.push(("passcode", value))
  }
  Frame::new("CONNECT", headers)
}

///|
pub fn send_message(
  destination : String,
  body : Bytes,
  transaction~ : String = "",
  receipt~ : String = "",
) -> Frame {
  let h = [
    ("destination", destination),
    ("content-type", "application/octet-stream"),
  ]
  if transaction != "" {
    h.push(("transaction", transaction))
  }
  if receipt != "" {
    h.push(("receipt", receipt))
  }
  Frame::new("SEND", h, body~)
}

///|
pub fn subscribe(
  id : String,
  destination : String,
  ack~ : String = "auto",
) -> Frame {
  Frame::new("SUBSCRIBE", [
    ("id", id),
    ("destination", destination),
    ("ack", ack),
  ])
}

///|
pub fn unsubscribe(id : String) -> Frame {
  Frame::new("UNSUBSCRIBE", [("id", id)])
}

///|
pub fn acknowledge(
  id : String,
  negative~ : Bool = false,
  transaction~ : String = "",
) -> Frame {
  let h = [("id", id)]
  if transaction != "" {
    h.push(("transaction", transaction))
  }
  Frame::new(if negative { "NACK" } else { "ACK" }, h)
}

///|
pub fn begin_transaction(id : String) -> Frame {
  Frame::new("BEGIN", [("transaction", id)])
}

///|
pub fn finish_transaction(id : String, commit~ : Bool = true) -> Frame {
  Frame::new(if commit { "COMMIT" } else { "ABORT" }, [("transaction", id)])
}

///|
pub fn disconnect(receipt : String) -> Frame {
  Frame::new("DISCONNECT", [("receipt", receipt)])
}

///|
/// Explicit negotiation while the original connect() remains a 1.2 constructor.
/// Legacy 1.0-only CONNECT omits host/version/heartbeat negotiation headers.
pub fn connect_versions(
  host : String,
  versions : Array[Version],
  heartbeat~ : String = "0,0",
  login? : String,
  passcode? : String,
) -> Frame raise ProtocolError {
  if versions.is_empty() || versions.length() > 3 {
    raise Invalid("offer one to three versions")
  }
  let mut text = ""
  for version in versions {
    text = text + (if text == "" { "" } else { "," }) + version.wire()
  }
  ignore(offered_versions(text))
  let (cx, cy) = heartbeat_pair(heartbeat)
  let headers : Array[(String, String)] = []
  if versions == [V10] {
    if cx != 0 || cy != 0 {
      raise Invalid("STOMP 1.0 has no heartbeat negotiation")
    }
  } else {
    headers.push(("accept-version", text))
    headers.push(("host", host))
    headers.push(("heart-beat", heartbeat))
  }
  if login is Some(value) {
    headers.push(("login", value))
  }
  if passcode is Some(value) {
    headers.push(("passcode", value))
  }
  Frame::new("CONNECT", headers)
}

///|
/// 1.0 accepts id-less subscriptions; 1.1/1.2 require an id.
pub fn subscribe_versioned(
  version : Version,
  destination : String,
  id~ : String = "",
  ack~ : String = "auto",
) -> Frame raise ProtocolError {
  if ack != "auto" &&
    ack != "client" &&
    (ack != "client-individual" || version == V10) {
    raise Invalid("invalid versioned acknowledgement mode")
  }
  let headers = [("destination", destination), ("ack", ack)]
  if id != "" {
    headers.push(("id", id))
  } else if version != V10 {
    raise Invalid("subscription id required")
  }
  Frame::new("SUBSCRIBE", headers)
}

///|
/// For 1.0 only, unsubscribe by destination when no id was supplied.
pub fn unsubscribe_destination(destination : String) -> Frame {
  Frame::new("UNSUBSCRIBE", [("destination", destination)])
}

///|
/// Caller supplies the original MESSAGE; formula-like reinterpretation of IDs is avoided.
pub fn acknowledge_message(
  version : Version,
  message : Frame,
  negative~ : Bool = false,
  transaction~ : String = "",
) -> Frame raise ProtocolError {
  if message.command != "MESSAGE" {
    raise Invalid("acknowledgement requires MESSAGE")
  }
  if negative && version == V10 {
    raise Invalid("NACK unavailable in STOMP 1.0")
  }
  let headers : Array[(String, String)] = []
  match version {
    V12 => headers.push(("id", required(message, "ack")))
    V11 => {
      headers.push(("message-id", required(message, "message-id")))
      headers.push(("subscription", required(message, "subscription")))
    }
    V10 => headers.push(("message-id", required(message, "message-id")))
  }
  if transaction != "" {
    headers.push(("transaction", transaction))
  }
  Frame::new(if negative { "NACK" } else { "ACK" }, headers)
}
