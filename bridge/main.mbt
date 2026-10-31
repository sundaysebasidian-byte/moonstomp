// Stable explicit JS boundary: no reliance on generated object field names.

///|
extern "js" fn expose(
  create : () -> @stomp.Client,
  state : (@stomp.Client) -> String,
  version : (@stomp.Client) -> String,
  send : (@stomp.Client, String, String, Bytes, Int64) -> Bytes,
  receive : (@stomp.Client, Bytes, Int64) -> Array[String],
  tick : (@stomp.Client, Int64) -> Bytes,
  close : (@stomp.Client) -> Unit,
  eof : (@stomp.Client) -> Bool,
  parse : (Bytes) -> Array[String],
  acknowledge : (@stomp.Client, String, Bool, String, Int64) -> Bytes,
) -> Unit =
  #| (create,state,version,send,receive,tick,close,eof,parse,acknowledge) => {
  #| const invalid = (operation, reason) => { const e = new Error(reason); e.name = 'MoonSTOMPArgumentError'; e.code = 'STOMP_ARGUMENT'; e.operation = operation; e.reason = reason; return e; };
  #| const clients = new WeakSet();
  #| const owned = (c, op) => { if (!clients.has(c)) throw invalid(op, 'client must be created by this bridge instance'); };
  #| const clock = (n, op) => { if (typeof n !== 'bigint' || n < 0n || n > 9223372036854775807n) throw invalid(op, 'clock must be a nonnegative Int64 bigint'); };
  #| const byteValues = Uint8Array.prototype.values;
  #| const bytes = (b, op) => { if (!(b instanceof Uint8Array)) throw invalid(op, 'body/chunk must be Uint8Array'); try { byteValues.call(b); } catch { throw invalid(op, 'body/chunk must have attached in-bounds storage'); } };
  #| const headers = (h, op) => { if (!Array.isArray(h) || h.some(p => !Array.isArray(p) || p.length !== 2 || p.some(v => typeof v !== 'string'))) throw invalid(op, 'header pairs must be strings'); return JSON.stringify(h); };
  #| const api = {create:() => { const c = create(); clients.add(c); return c; }, state:c => { owned(c,'state'); return state(c); }, version:c => { owned(c,'version'); return version(c); }, send:(c,cmd,h,b,n) => {
  #|   owned(c,'send');
  #|   if (typeof cmd !== 'string') throw invalid('send', 'command must be a string');
  #|   bytes(b,'send'); clock(n,'send'); return send(c,cmd,headers(h,'send'),b,n);
  #| }, receive:(c,b,n) => { owned(c,'receive'); bytes(b,'receive'); clock(n,'receive'); return receive(c,b,n); }, tick:(c,n) => { owned(c,'tick'); clock(n,'tick'); return tick(c,n); }, close:c => { owned(c,'close'); return close(c); }, eof:c => { owned(c,'eof'); return eof(c); }, parse:b => { bytes(b,'parse'); return parse(b); },
  #| acknowledge:(c,h,negative,transaction,n) => { owned(c,'acknowledge'); if (typeof negative !== 'boolean' || typeof transaction !== 'string') throw invalid('acknowledge', 'negative/transaction types invalid'); clock(n,'acknowledge'); return acknowledge(c,headers(h,'acknowledge'),negative,transaction,n); }};
  #| globalThis.MoonSTOMP = api;
  #| if (typeof module !== 'undefined' && module.exports) module.exports = api;
  #| }

///|
extern "js" fn throw_protocol_error(
  operation : String,
  reason : String,
) -> Unit =
  #| (operation, reason) => { const e = new Error(reason); e.name = 'MoonSTOMPProtocolError'; e.code = 'STOMP_INVALID'; e.operation = operation; e.reason = reason; throw e; }

///|
fn[T] failed(operation : String, error : @stomp.ProtocolError) -> T {
  match error {
    @stomp.Invalid(reason) => throw_protocol_error(operation, reason)
  }
  // The JS FFI always throws. Keep the MoonBit return type total for all callers.
  abort("unreachable after JS protocol error")
}

///|
fn frame_json(f : @stomp.Frame) -> String {
  let headers : Json = Json::array(
    f.headers.map(h => Json::array([Json::string(h.0), Json::string(h.1)])),
  )
  let body : Json = Json::array(
    f.body.to_array().map(b => Json::number(b.to_int().to_double())),
  )
  Json::object({
    "command": Json::string(f.command),
    "headers": headers,
    "body": body,
  }).stringify()
}

///|
fn main {
  expose(
    () => @stomp.Client::new() catch { error => failed("create", error) },
    c => {
      match c.state() {
        Fresh => "fresh"
        Connecting => "connecting"
        Active => "active"
        Disconnecting => "disconnecting"
        Closed => "closed"
      }
    },
    c => {
      match c.version() {
        Some(version) => version.wire()
        None => ""
      }
    },
    (c, command, headers, body, now) => {
      c.send(
        @stomp.Frame::new(command, decode_headers(headers, "send"), body~),
        now,
      ) catch {
        error => failed("send", error)
      }
    },
    (c, chunk, now) => {
      let events = c.receive(chunk, now) catch {
        error => failed("receive", error)
      }
      events.map(e => {
        match e {
          Connected => "{\"event\":\"connected\"}"
          Heartbeat => "{\"event\":\"heartbeat\"}"
          Receipt(id) =>
            Json::object({
              "event": Json::string("receipt"),
              "id": Json::string(id),
            }).stringify()
          Message(f) =>
            "{\"event\":\"message\",\"frame\":" + frame_json(f) + "}"
          ServerError(f) =>
            "{\"event\":\"error\",\"frame\":" + frame_json(f) + "}"
        }
      })
    },
    (c, now) => c.tick(now) catch { error => failed("tick", error) },
    c => c.fail(),
    c => {
      try {
        c.end()
        true
      } catch {
        _ => false
      }
    },
    bytes => {
      let d = @stomp.Decoder::new() catch { error => failed("parse", error) }
      let events = d.feed(bytes) catch { error => failed("parse", error) }
      d.end() catch {
        error => failed("parse", error)
      }
      events.map(e => {
        match e {
          Heartbeat => "{\"heartbeat\":true}"
          Frame(f) => frame_json(f)
        }
      })
    },
    (c, headers, negative, transaction, now) => {
      let version = match c.version() {
        Some(v) => v
        None => {
          throw_protocol_error("acknowledge", "client is not active")
          abort("unreachable after JS protocol error")
        }
      }
      try {
        let frame = @stomp.acknowledge_message(
          version,
          @stomp.Frame::new("MESSAGE", decode_headers(headers, "acknowledge")),
          negative~,
          transaction~,
        )
        c.send(frame, now)
      } catch {
        error => failed("acknowledge", error)
      }
    },
  )
}

///|
fn decode_headers(text : String, operation : String) -> Array[(String, String)] {
  @json.from_json(@json.parse(text)) catch {
    _ => {
      throw_protocol_error(operation, "invalid header pair JSON")
      abort("unreachable after JS protocol error")
    }
  }
}
