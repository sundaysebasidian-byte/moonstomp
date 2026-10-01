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
) -> Decoder raise ProtocolError {
  if limits.max_line < 1 ||
    limits.max_headers < 0 ||
    limits.max_body < 0 ||
    limits.max_events < 1 {
    raise Invalid("invalid decoder limits")
  }
  {
    limits,
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
  if !body_allowed(self.command) && self.body.length() > 0 {
    raise Invalid("body forbidden")
  }
  events.push(
    Frame(
      Frame::new(self.command, self.headers, body=Bytes::from_array(self.body)),
    ),
  )
  self.line.clear()
  self.headers.clear()
  self.body.clear()
  self.command = ""
  self.length = -1
  self.phase = 0
}

///|
fn Decoder::line_done(
  self : Decoder,
  events : Array[WireEvent],
) -> Unit raise ProtocolError {
  if self.line.length() > 0 && self.line[self.line.length() - 1] == b'\r' {
    ignore(self.line.pop())
  }
  let text = @utf8.decode(Bytes::from_array(self.line)) catch {
    _ => raise Invalid("invalid UTF8 header")
  }
  self.line.clear()
  for c in text {
    if c == '\r' {
      raise Invalid("bare CR")
    }
  }
  if self.phase == 0 {
    if text == "" {
      if events.length() >= self.limits.max_events {
        raise Invalid("event limit")
      }
      events.push(Heartbeat)
    } else {
      if !valid_command(text) {
        raise Invalid("unknown command")
      }
      self.command = text
      self.phase = 1
    }
  } else if text == "" {
    let f = Frame::new(self.command, self.headers)
    self.length = match f.header("content-length") {
      Some(s) => decimal(s, self.limits.max_body)
      None => -1
    }
    self.phase = if self.length == 0 { 3 } else { 2 }
  } else {
    if self.headers.length() >= self.limits.max_headers {
      raise Invalid("header count limit")
    }
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
    let key = String::from_array(chars[:colon].to_owned())
    let value = String::from_array(chars[colon + 1:].to_owned())
    self.headers.push(
      if unescaped(self.command) {
        (raw_header(key, true), raw_header(value, false))
      } else {
        (unescape_header(key), unescape_header(value))
      },
    )
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
