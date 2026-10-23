///|
pub enum WireEvent {
  Heartbeat
  Frame(Frame)
} derive(Debug, Eq)

///|
/// Resource limits apply while data arrives, before allocating an entire frame.
pub struct Limits {
  max_line : Int
  max_headers : Int
  max_body : Int
  max_events : Int
} derive(Debug)

///|
pub fn Limits::default() -> Limits {
  { max_line: 8192, max_headers: 128, max_body: 1048576, max_events: 1024, }
}

///|
/// Single pass across arbitrary chunks. Fatal errors poison the decoder.
pub struct Decoder {
  limits : Limits
  mut version : Version
  mut negotiation : Array[Version]?
  mut frame_crlf : Bool
  handshake_headers : Array[String]
  line : Array[Byte]
  headers : Array[(String, String)]
  body : Array[Byte]
  mut phase : Int // 0 command, 1 headers, 2 body, 3 terminator
  mut command : String
  mut length : Int // -1 means NUL terminated
  mut failed : Bool
}

///|
pub fn Decoder::new(
  limits? : Limits = Limits::default(),
  version? : Version = V12,
) -> Decoder raise ProtocolError {
  if limits.max_line < 1 ||
    limits.max_headers < 0 ||
    limits.max_body < 0 ||
    limits.max_events < 1 {
    raise Invalid("invalid decoder limits")
  }
  {
    limits,
    version,
    negotiation: None,
    frame_crlf: false,
    handshake_headers: [],
    line: [],
    headers: [],
    body: [],
    phase: 0,
    command: "",
    length: -1,
    failed: false,
  }
}

///|
fn Decoder::finish_frame(
  self : Decoder,
  events : Array[WireEvent],
) -> Unit raise ProtocolError {
  if events.length() >= self.limits.max_events {
    raise Invalid("event limit")
  }
  // STOMP 1.0 also explicitly requires RECEIPT to have an empty body.
  // Its other legacy command bodies retain the existing tolerant behavior.
  if (self.version != V10 || self.command == "RECEIPT") &&
    !body_allowed(self.command) &&
    self.body.length() > 0 {
    raise Invalid("body forbidden")
  }
  events.push(
    Frame(
      Frame::new(self.command, self.headers, body=Bytes::from_array(self.body)),
    ),
  )
  self.line.clear()
  self.headers.clear()
  self.handshake_headers.clear()
  self.body.clear()
  self.command = ""
  self.frame_crlf = false
  self.length = -1
  self.phase = 0
}

///|
fn split_header(text : String) -> (String, String) raise ProtocolError {
  let chars = text.to_array()
  let mut colon = -1
  for i = 0; i < chars.length(); i = i + 1 {
    if chars[i] == ':' {
      colon = i
      break
    }
  }
  if colon <= 0 {
    raise Invalid("header missing colon or key")
  }
  (
    String::from_array(chars[:colon].to_owned()),
    String::from_array(chars[colon + 1:].to_owned()),
  )
}

///|
fn strip_eol_cr(text : String) -> String {
  if text.has_suffix("\r") {
    let chars = text.to_array()
    String::from_array(chars[:chars.length() - 1].to_owned())
  } else {
    text
  }
}

///|
fn Decoder::add_header(
  self : Decoder,
  text : String,
) -> Unit raise ProtocolError {
  if self.headers.length() >= self.limits.max_headers {
    raise Invalid("header count limit")
  }
  let (key, value) = split_header(text)
  self.headers.push(
    if self.version == V10 || unescaped(self.command) {
      (
        raw_header(key, true, version=self.version),
        raw_header(value, false, version=self.version),
      )
    } else {
      (
        unescape_versioned(key, self.version),
        unescape_versioned(value, self.version),
      )
    },
  )
}

///|
/// Defer CONNECTED header normalization until its version is known. Older versions
/// allow literal CR in headers; treating those octets as EOL loses data.
fn Decoder::select_version(
  self : Decoder,
  offered : Array[Version],
) -> Unit raise ProtocolError {
  let mut selected = V10
  for line in self.handshake_headers {
    let (key, value) = split_header(line)
    if key == "version" {
      selected = parse_version(strip_eol_cr(value))
      break
    }
  }
  if !offered.contains(selected) || (selected != V12 && self.frame_crlf) {
    raise Invalid("invalid version negotiation or CONNECTED EOL")
  }
  self.version = selected
  for line in self.handshake_headers {
    self.add_header(if selected == V12 { strip_eol_cr(line) } else { line })
  }
  let frame = Frame::new(self.command, self.headers)
  // Provisional selection must not silently trim a legacy version header.
  if parse_version(frame.header("version").unwrap_or("1.0")) != selected {
    raise Invalid("invalid version header")
  }
  self.handshake_headers.clear()
  self.negotiation = None
}

///|
fn Decoder::start_body(self : Decoder) -> Unit raise ProtocolError {
  let frame = Frame::new(self.command, self.headers)
  self.length = match frame.header("content-length") {
    Some(s) => decimal(s, self.limits.max_body)
    None => -1
  }
  self.phase = if self.length == 0 { 3 } else { 2 }
}

///|
fn Decoder::line_done(
  self : Decoder,
  events : Array[WireEvent],
) -> Unit raise ProtocolError {
  let raw = @utf8.decode(Bytes::from_array(self.line)) catch {
    _ => raise Invalid("invalid UTF8 header")
  }
  self.line.clear()
  if self.phase == 0 {
    let text = if self.version == V12 { strip_eol_cr(raw) } else { raw }
    if text == "" {
      if events.length() >= self.limits.max_events {
        raise Invalid("event limit")
      }
      events.push(Heartbeat)
    } else {
      if self.version == V10 && (text == "STOMP" || text == "NACK") {
        raise Invalid("command unavailable in STOMP 1.0")
      }
      if !valid_command(text) {
        raise Invalid("unknown command")
      }
      self.frame_crlf = raw.has_suffix("\r")
      self.command = text
      self.phase = 1
    }
    return
  }
  match self.negotiation {
    Some(offered) =>
      if self.command == "CONNECTED" {
        if raw == "" || raw == "\r" {
          self.frame_crlf = self.frame_crlf || raw == "\r"
          self.select_version(offered)
          self.start_body()
        } else {
          if self.handshake_headers.length() >= self.limits.max_headers {
            raise Invalid("header count limit")
          }
          self.handshake_headers.push(raw)
        }
        return
      }
    None => ()
  }
  let text = if self.version == V12 { strip_eol_cr(raw) } else { raw }
  if text == "" {
    self.start_body()
  } else {
    self.add_header(text)
  }
}

///|
fn Decoder::consume(
  self : Decoder,
  chunk : Bytes,
) -> Array[WireEvent] raise ProtocolError {
  let events : Array[WireEvent] = []
  for b in chunk {
    if self.phase <= 1 {
      if b == b'\x00' {
        raise Invalid("NUL in command/header")
      }
      if b == b'\n' {
        self.line_done(events)
      } else {
        if self.line.length() >= self.limits.max_line {
          raise Invalid("line limit")
        }
        self.line.push(b)
      }
    } else if self.phase == 3 {
      if b != b'\x00' {
        raise Invalid("expected NUL after content-length")
      }
      self.finish_frame(events)
    } else if self.length < 0 && b == b'\x00' {
      self.finish_frame(events)
    } else {
      if self.body.length() >= self.limits.max_body {
        raise Invalid("body limit")
      }
      self.body.push(b)
      if self.length >= 0 && self.body.length() == self.length {
        self.phase = 3
      }
    }
  }
  events
}

///|
pub fn Decoder::feed(
  self : Decoder,
  chunk : Bytes,
) -> Array[WireEvent] raise ProtocolError {
  if self.failed {
    raise Invalid("decoder poisoned")
  }
  errdefer {
    self.failed = true
    self.line.clear()
    self.headers.clear()
    self.handshake_headers.clear()
    self.body.clear()
  }
  self.consume(chunk)
}

///|
/// Signal EOF: distinguishes a clean boundary from a truncated frame/CR heartbeat.
pub fn Decoder::end(self : Decoder) -> Unit raise ProtocolError {
  if self.failed || self.phase != 0 || self.line.length() != 0 {
    self.discard()
    raise Invalid("truncated or poisoned stream")
  }
  self.discard()
}

///|
pub extend WireEvent with @debug.Debug::{to_repr}

///|
pub extend WireEvent with Eq::{equal, not_equal}

///|
pub extend Limits with @debug.Debug::{to_repr}

///|
/// Reset owned buffers on transport failure and prevent further parsing.
fn Decoder::discard(self : Decoder) -> Unit {
  self.failed = true
  self.line.clear()
  self.headers.clear()
  self.handshake_headers.clear()
  self.body.clear()
  self.command = ""
  self.phase = 0
  self.length = -1
}

///|
/// Public configuration constructor; limits are bytes, counts and events per feed.
pub fn Limits::new(
  max_line? : Int = 8192,
  max_headers? : Int = 128,
  max_body? : Int = 1048576,
  max_events? : Int = 1024,
) -> Limits raise ProtocolError {
  if max_line < 1 || max_headers < 0 || max_body < 0 || max_events < 1 {
    raise Invalid("invalid decoder limits")
  }
  { max_line, max_headers, max_body, max_events, }
}

///|
/// Client-only handshake setup. A standalone decoder stays on its explicit version.
fn Decoder::expect_versions(self : Decoder, offered : Array[Version]) -> Unit {
  self.negotiation = Some(offered.copy())
  // CONNECTED is unescaped. Accept its 1.2 EOL form until selection is known.
  self.version = V12
}
