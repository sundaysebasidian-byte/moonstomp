///|
/// Protocol errors are fatal for a decoder/connection.
pub suberror ProtocolError {
  Invalid(String)
} derive(Debug)

///|
/// Ordered headers preserve repetition/history. `header` returns the first.
pub struct Frame {
  command : String
  headers : Array[(String, String)]
  body : Bytes
} derive(Debug, Eq)

///|
pub fn Frame::new(
  command : String,
  headers : Array[(String, String)],
  body? : Bytes = b"",
) -> Frame {
  { command, headers: headers.copy(), body, }
}

///|
pub fn Frame::header(self : Frame, key : String) -> String? {
  for pair in self.headers {
    if pair.0 == key {
      return Some(pair.1)
    }
  }
  None
}

///|
pub fn valid_command(command : String) -> Bool {
  match command {
    "CONNECT"
    | "STOMP"
    | "CONNECTED"
    | "SEND"
    | "SUBSCRIBE"
    | "UNSUBSCRIBE"
    | "ACK"
    | "NACK"
    | "BEGIN"
    | "COMMIT"
    | "ABORT"
    | "DISCONNECT"
    | "MESSAGE"
    | "RECEIPT"
    | "ERROR" => true
    _ => false
  }
}

///|
fn body_allowed(command : String) -> Bool {
  command == "SEND" || command == "MESSAGE" || command == "ERROR"
}

///|
fn unescaped(command : String) -> Bool {
  command == "CONNECT" || command == "CONNECTED"
}

///|
/// Decimal only, bounded before multiplying; no sign, whitespace or overflow.
fn decimal(s : String, limit : Int) -> Int raise ProtocolError {
  if s.length() == 0 {
    raise Invalid("empty decimal")
  }
  let mut n = 0
  for c in s {
    if c < '0' || c > '9' {
      raise Invalid("non-decimal length")
    }
    let digit = c.to_int() - 48
    if n > limit / 10 || (n == limit / 10 && digit > limit % 10) {
      raise Invalid("decimal exceeds limit")
    }
    n = n * 10 + digit
  }
  n
}

///|
pub extend ProtocolError with @debug.Debug::{to_repr}

///|
pub extend Frame with @debug.Debug::{to_repr}

///|
pub extend Frame with Eq::{equal, not_equal}
