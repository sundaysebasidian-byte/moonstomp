// Stable explicit JS boundary: no reliance on generated object field names.

///|
extern "js" fn expose(
  create : () -> @stomp.Client,
  state : (@stomp.Client) -> String,
  send : (@stomp.Client, String, String, Bytes, Int64) -> Bytes,
  receive : (@stomp.Client, Bytes, Int64) -> Array[String],
  tick : (@stomp.Client, Int64) -> Bytes,
  close : (@stomp.Client) -> Unit,
  eof : (@stomp.Client) -> Bool,
  parse : (Bytes) -> Array[String],
) -> Unit =
  #| (create,state,send,receive,tick,close,eof,parse) => {
  #| const wrap = f => (...args) => { try { return f(...args); } catch(e) { throw new Error('MoonSTOMP protocol error'); } };
  #| globalThis.MoonSTOMP = {create, state, send:wrap((c,cmd,h,b,n) => send(c,cmd,JSON.stringify(h),b,n)), receive:wrap(receive), tick:wrap(tick), close, eof, parse:wrap(parse)};
  #| }

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
    () => @stomp.Client::new() catch { _ => abort("configuration") },
    c => {
      match c.state() {
        Fresh => "fresh"
        Connecting => "connecting"
        Active => "active"
        Disconnecting => "disconnecting"
        Closed => "closed"
      }
    },
    (c, command, headers, body, now) => {
      c.send(@stomp.Frame::new(command, decode_headers(headers), body~), now) catch {
        _ => abort("send")
      }
    },
    (c, chunk, now) => {
      let events = c.receive(chunk, now) catch { _ => abort("receive") }
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
    (c, now) => c.tick(now) catch { _ => abort("tick") },
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
      let d = @stomp.Decoder::new() catch { _ => abort("decoder") }
      let events = d.feed(bytes) catch { _ => abort("decode") }
      d.end() catch {
        _ => abort("EOF")
      }
      events.map(e => {
        match e {
          Heartbeat => "{\"heartbeat\":true}"
          Frame(f) => frame_json(f)
        }
      })
    },
  )
}

///|
fn decode_headers(text : String) -> Array[(String, String)] {
  @json.from_json(@json.parse(text)) catch {
    _ => abort("headers")
  }
}
