///|
pub enum State {
  Fresh
  Connecting
  Active
  Disconnecting
  Closed
} derive(Debug, Eq)

///|
pub enum ClientEvent {
  Connected
  Message(Frame)
  Receipt(String)
  ServerError(Frame)
  Heartbeat
} derive(Debug, Eq)

///|
struct Delivery {
  id : String
  subscription : String
  cumulative : Bool
  mut staged : String?
}

///|
/// A sans-I/O client. Caller writes returned bytes and calls `fail` on write failure.
pub struct Client {
  decoder : Decoder
  capacity : Int
  max_pending : Int
  subscriptions : Array[(String, String)]
  transactions : Array[String]
  receipts : Array[String]
  deliveries : Array[Delivery]
  mut state : State
  mut clock : HeartbeatClock?
  mut last_now : Int64
  mut cx : Int
  mut cy : Int
  mut disconnect_receipt : String?
}

///|
pub fn Client::new(
  capacity? : Int = 256,
  max_pending? : Int = 1024,
) -> Client raise ProtocolError {
  if capacity < 1 || max_pending < 1 {
    raise Invalid("invalid client capacity")
  }
  {
    decoder: Decoder::new(),
    capacity,
    max_pending,
    subscriptions: [],
    transactions: [],
    receipts: [],
    deliveries: [],
    state: Fresh,
    clock: None,
    last_now: 0,
    cx: 0,
    cy: 0,
    disconnect_receipt: None,
  }
}

///|
pub fn Client::state(self : Client) -> State {
  self.state
}

///|
pub fn Client::fail(self : Client) -> Unit {
  self.state = Closed
  self.subscriptions.clear()
  self.transactions.clear()
  self.receipts.clear()
  self.deliveries.clear()
  self.clock = None
  self.disconnect_receipt = None
  self.decoder.discard()
}

///|
fn required(f : Frame, key : String) -> String raise ProtocolError {
  match f.header(key) {
    Some(s) =>
      if s == "" {
        raise Invalid("empty required header " + key)
      } else {
        s
      }
    None => raise Invalid("missing header " + key)
  }
}

///|
fn Client::subscription_mode(self : Client, id : String) -> String? {
  for s in self.subscriptions {
    if s.0 == id {
      return Some(s.1)
    }
  }
  None
}

///|
fn Client::check_transaction(
  self : Client,
  frame : Frame,
) -> Unit raise ProtocolError {
  match frame.header("transaction") {
    Some(tx) =>
      if !self.transactions.contains(tx) {
        raise Invalid("unknown transaction")
      }
    None => ()
  }
}

///|
fn remove_string(a : Array[String], s : String) -> Unit {
  for i = 0; i < a.length(); i = i + 1 {
    if a[i] == s {
      ignore(a.remove(i))
      return
    }
  }
}

///|
fn Client::check_ack(self : Client, f : Frame) -> Int raise ProtocolError {
  let id = required(f, "id")
  for i = 0; i < self.deliveries.length(); i = i + 1 {
    if self.deliveries[i].id == id {
      if self.deliveries[i].staged != None {
        raise Invalid("ack already staged")
      }
      return i
    }
  }
  raise Invalid("unknown acknowledgement id")
}

///|
fn Client::settle(self : Client, index : Int, tx : String?) -> Unit {
  let selected = self.deliveries[index]
  let cumulative = selected.cumulative
  let mut i = index
  while i >= 0 {
    let item = self.deliveries[i]
    if i == index || (cumulative && item.subscription == selected.subscription) {
      // Validate overlap before modifying in `send`.
      match tx {
        Some(t) => item.staged = Some(t)
        None => ignore(self.deliveries.remove(i))
      }
    }
    i = i - 1
  }
}

///|
/// Validates and commits local intent before returning wire bytes. Outbound API misuse
/// does not poison the client; a transport write failure must close it.
pub fn Client::send(
  self : Client,
  f : Frame,
  now : Int64,
) -> Bytes raise ProtocolError {
  self.advance(now)
  match self.clock {
    Some(c) => c.advance(now)
    None => ()
  }
  if f.headers.length() > 128 || f.body.length() > 1048576 {
    raise Invalid("outbound limit")
  }
  for h in f.headers {
    if @utf8.encode(h.0).length() + @utf8.encode(h.1).length() > 2047 {
      raise Invalid("outbound header limit")
    }
  }
  let bytes = encode(f)
  if self.state == Fresh {
    if f.command != "CONNECT" && f.command != "STOMP" {
      raise Invalid("connect first")
    }
    ignore(required(f, "host"))
    if required(f, "accept-version") != "1.2" {
      raise Invalid("only 1.2 supported")
    }
    if f.header("receipt") != None {
      raise Invalid("CONNECT receipt forbidden")
    }
    let (cx, cy) = heartbeat_pair(f.header("heart-beat").unwrap_or("0,0"))
    self.cx = cx
    self.cy = cy
    self.state = Connecting
    return bytes
  }
  if self.state != Active {
    raise Invalid("client is not active")
  }
  match f.header("receipt") {
    Some(r) => {
      if r == "" || self.receipts.contains(r) {
        raise Invalid("duplicate/empty receipt")
      }
      if self.receipts.length() >= self.capacity {
        raise Invalid("receipt capacity")
      }
    }
    None => ()
  }
  // Complete validation before mutating subscriptions/transactions/deliveries.
  match f.command {
    "SEND" => {
      ignore(required(f, "destination"))
      self.check_transaction(f)
    }
    "SUBSCRIBE" => {
      let id = required(f, "id")
      ignore(required(f, "destination"))
      if self.subscription_mode(id) != None {
        raise Invalid("duplicate subscription")
      }
      for delivery in self.deliveries {
        if delivery.subscription == id {
          raise Invalid("subscription id has unsettled deliveries")
        }
      }
      if self.subscriptions.length() >= self.capacity {
        raise Invalid("subscription capacity")
      }
      match f.header("ack").unwrap_or("auto") {
        "auto" | "client" | "client-individual" => ()
        _ => raise Invalid("invalid ack mode")
      }
    }
    "UNSUBSCRIBE" =>
      if self.subscription_mode(required(f, "id")) == None {
        raise Invalid("unknown subscription")
      }
    "BEGIN" => {
      let tx = required(f, "transaction")
      if self.transactions.contains(tx) {
        raise Invalid("duplicate transaction")
      }
      if self.transactions.length() >= self.capacity {
        raise Invalid("transaction capacity")
      }
    }
    "COMMIT" | "ABORT" => {
      ignore(required(f, "transaction"))
      self.check_transaction(f)
    }
    "ACK" | "NACK" => {
      self.check_transaction(f)
      let i = self.check_ack(f)
      let item = self.deliveries[i]
      if item.cumulative {
        for j = 0; j <= i; j = j + 1 {
          if self.deliveries[j].subscription == item.subscription &&
            self.deliveries[j].staged != None {
            raise Invalid("cumulative ack overlaps transaction")
          }
        }
      }
    }
    "DISCONNECT" => ()
    _ => raise Invalid("not a client command")
  }
  match f.command {
    "SUBSCRIBE" =>
      self.subscriptions.push(
        (required(f, "id"), f.header("ack").unwrap_or("auto")),
      )
    "UNSUBSCRIBE" => {
      let id = required(f, "id")
      for i = self.subscriptions.length() - 1; i >= 0; i = i - 1 {
        if self.subscriptions[i].0 == id {
          ignore(self.subscriptions.remove(i))
        }
      }
      // Pending acknowledgements remain valid until explicitly settled/connection closes.
    }
    "BEGIN" => self.transactions.push(required(f, "transaction"))
    "COMMIT" | "ABORT" => {
      let tx = required(f, "transaction")
      for i = self.deliveries.length() - 1; i >= 0; i = i - 1 {
        if self.deliveries[i].staged == Some(tx) {
          if f.command == "COMMIT" {
            ignore(self.deliveries.remove(i))
          } else {
            self.deliveries[i].staged = None
          }
        }
      }
      remove_string(self.transactions, tx)
    }
    "ACK" | "NACK" => self.settle(self.check_ack(f), f.header("transaction"))
    "DISCONNECT" => {
      self.state = Disconnecting
      self.disconnect_receipt = f.header("receipt")
    }
    _ => ()
  }
  match f.header("receipt") {
    Some(r) => self.receipts.push(r)
    None => ()
  }
  match self.clock {
    Some(c) => c.sent_data(now)
    None => ()
  }
  if self.state == Disconnecting && self.disconnect_receipt == None {
    self.fail()
  }
  bytes
}

///|
fn Client::accept_frame(
  self : Client,
  f : Frame,
  now : Int64,
) -> ClientEvent raise ProtocolError {
  if f.command == "ERROR" {
    self.fail()
    return ServerError(f)
  }
  if self.state == Connecting {
    if f.command != "CONNECTED" || required(f, "version") != "1.2" {
      raise Invalid("invalid version negotiation")
    }
    let (sx, sy) = heartbeat_pair(f.header("heart-beat").unwrap_or("0,0"))
    self.clock = Some(
      HeartbeatClock::new(negotiate_heartbeat(self.cx, self.cy, sx, sy), now),
    )
    self.state = Active
    return Connected
  }
  if self.state != Active && self.state != Disconnecting {
    raise Invalid("unexpected server frame")
  }
  match f.command {
    "MESSAGE" => {
      ignore(required(f, "destination"))
      ignore(required(f, "message-id"))
      let sub = required(f, "subscription")
      let mode = match self.subscription_mode(sub) {
        Some(m) => m
        None => raise Invalid("unknown MESSAGE subscription")
      }
      if mode != "auto" {
        let id = required(f, "ack")
        if self.deliveries.length() >= self.max_pending {
          raise Invalid("pending delivery limit")
        }
        for d in self.deliveries {
          if d.id == id {
            raise Invalid("duplicate acknowledgement id")
          }
        }
        self.deliveries.push({
          id,
          subscription: sub,
          cumulative: mode == "client",
          staged: None,
        })
      }
      Message(f)
    }
    "RECEIPT" => {
      let id = required(f, "receipt-id")
      if !self.receipts.contains(id) {
        raise Invalid("unsolicited receipt")
      }
      remove_string(self.receipts, id)
      if self.disconnect_receipt == Some(id) {
        self.fail()
      }
      Receipt(id)
    }
    _ => raise Invalid("unexpected server command")
  }
}

///|
/// Any network bytes update liveness, even an incomplete frame.
pub fn Client::receive(
  self : Client,
  chunk : Bytes,
  now : Int64,
) -> Array[ClientEvent] raise ProtocolError {
  errdefer self.fail()
  self.advance(now)
  if self.state == Closed || self.state == Fresh {
    raise Invalid("receive in invalid state")
  }
  match self.clock {
    Some(c) =>
      if chunk.length() > 0 {
        c.received_data(now)
      } else {
        c.advance(now)
      }
    None => ()
  }
  let out : Array[ClientEvent] = []
  for e in self.decoder.feed(chunk) {
    match e {
      WireEvent::Heartbeat => out.push(ClientEvent::Heartbeat)
      WireEvent::Frame(f) => out.push(self.accept_frame(f, now))
    }
  }
  out
}

///|
/// Returns LF only when needed; timeout closes client and raises a protocol error.
pub fn Client::tick(self : Client, now : Int64) -> Bytes raise ProtocolError {
  errdefer self.fail()
  if self.state != Active {
    return b""
  }
  self.advance(now)
  match self.clock {
    Some(c) => {
      let (due, dead) = c.poll(now)
      if dead {
        raise Invalid("heartbeat timeout")
      }
      if due {
        c.sent_data(now)
        b"\n"
      } else {
        b""
      }
    }
    None => b""
  }
}

///|
/// EOF always closes the connection, and reports truncation if the decoder is mid-frame.
pub fn Client::end(self : Client) -> Unit raise ProtocolError {
  defer self.fail()
  self.decoder.end()
}

///|
pub fn Client::pending_deliveries(self : Client) -> Int {
  self.deliveries.length()
}

///|
pub fn Client::pending_receipts(self : Client) -> Int {
  self.receipts.length()
}

///|
pub extend State with @debug.Debug::{to_repr}

///|
pub extend State with Eq::{equal, not_equal}

///|
pub extend ClientEvent with @debug.Debug::{to_repr}

///|
pub extend ClientEvent with Eq::{equal, not_equal}

///|
/// Validate caller-supplied time throughout negotiation as well as active heartbeats.
fn Client::advance(self : Client, now : Int64) -> Unit raise ProtocolError {
  if now < self.last_now {
    raise Invalid("clock moved backwards")
  }
  self.last_now = now
}
