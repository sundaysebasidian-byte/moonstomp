pub fn escape_header(value : String) -> String raise ProtocolError {
  let chars : Array[Char] = []
  for c in value {
    match c {
      '\x00' => raise Invalid("NUL in header")
      '\\' => { chars.push('\\'); chars.push('\\') }
      '\r' => { chars.push('\\'); chars.push('r') }
      '\n' => { chars.push('\\'); chars.push('n') }
      ':' => { chars.push('\\'); chars.push('c') }
      _ => chars.push(c)
    }
  }
  String::from_array(chars)
}

pub fn unescape_header(value : String) -> String raise ProtocolError {
  let chars : Array[Char] = []
  let mut escaped = false
  for c in value {
    if escaped {
      chars.push(match c {
        'r' => '\r'
        'n' => '\n'
        'c' => ':'
        '\\' => '\\'
        _ => raise Invalid("undefined header escape")
      })
      escaped = false
    } else if c == '\\' {
      escaped = true
    } else {
      if c == '\x00' || c == '\r' || c == '\n' || c == ':' {
        raise Invalid("raw delimiter in header")
      }
      chars.push(c)
    }
  }
  if escaped { raise Invalid("trailing header escape") }
  String::from_array(chars)
}

fn raw_header(s : String, key : Bool) -> String raise ProtocolError {
  for c in s {
    if c == '\x00' || c == '\n' || c == '\r' || (key && c == ':') {
      raise Invalid("invalid CONNECT header")
    }
  }
  s
}

/// Emits LF and a content-length for every nonempty body (including binary NUL).
pub fn encode(frame : Frame) -> Bytes raise ProtocolError {
  if !valid_command(frame.command) { raise Invalid("unknown command") }
  if !body_allowed(frame.command) && frame.body.length() != 0 {
    raise Invalid("body forbidden for command")
  }
  let mut text = frame.command + "\n"
  for pair in frame.headers {
    if pair.0.length() == 0 { raise Invalid("empty header name") }
    let key = if unescaped(frame.command) { raw_header(pair.0, true) } else { escape_header(pair.0) }
    let value = if unescaped(frame.command) { raw_header(pair.1, false) } else { escape_header(pair.1) }
    text = text + key + ":" + value + "\n"
  }
  match frame.header("content-length") {
    Some(n) => if decimal(n, 2147483647) != frame.body.length() { raise Invalid("length mismatch") }
    None => if frame.body.length() > 0 { text = text + "content-length:" + frame.body.length().to_string() + "\n" }
  }
  let bytes = @utf8.encode(text + "\n").to_array()
  for b in frame.body { bytes.push(b) }
  bytes.push(b'\x00')
  Bytes::from_array(bytes)
}
