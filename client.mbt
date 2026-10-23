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
  destinations : Array[(String, String)] // internal subscription key, destination
  mut offered : Array[Version]
  mut version : Version?
  unsubscribing : Array[(String, String)] // subscription id, receipt fence
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
    destinations: [],
    offered: [V12],
    version: None,
    unsubscribing: [],
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
  self.destinations.clear()
  self.unsubscribing.clear()
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
fn Client::remove_subscription(self : Client, id : String) -> Unit {
  for i = self.subscriptions.length() - 1; i >= 0; i = i - 1 {
    if self.subscriptions[i].0 == id {
      ignore(self.subscriptions.remove(i))
      for j = self.destinations.length() - 1; j >= 0; j = j - 1 {
        if self.destinations[j].0 == id {
          ignore(self.destinations.remove(j))
        }
      }
    }
  }
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
  let version = self.version.unwrap_or(V12)
  let id = required(f, if version == V12 { "id" } else { "message-id" })
  let subscription = if version == V11 {
    Some(required(f, "subscription"))
  } else {
    None
  }
  for i = 0; i < self.deliveries.length(); i = i + 1 {
    if self.deliveries[i].id == id &&
      (
        subscription == None ||
        subscription == Some(self.deliveries[i].subscription)
      ) {
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
  let automatic_length = f.body.length() > 0 &&
    f.header("content-length") == None
  if f.headers.length() > 128 ||
    (automatic_length && f.headers.length() == 128) ||
    f.body.length() > 1048576 {
    raise Invalid("outbound limit")
  }
  for h in f.headers {
    if @utf8.encode(h.0).length() + @utf8.encode(h.1).length() > 2047 {
      raise Invalid("outbound header limit")
    }
  }
  let wire_version = if self.state == Fresh &&
    (f.command == "CONNECT" || f.command == "STOMP") {
    let offered = offered_versions(f.header("accept-version").unwrap_or("1.0"))
    if offered.contains(V12) {
      V12
    } else if offered.contains(V11) {
      V11
    } else {
      V10
    }
  } else {
    self.version.unwrap_or(V12)
  }
  let bytes = encode_versioned(f, wire_version)
  if self.state == Fresh {
    if f.command != "CONNECT" && f.command != "STOMP" {
      raise Invalid("connect first")
    }
    let offered = offered_versions(f.header("accept-version").unwrap_or("1.0"))
    if offered != [V10] {
      ignore(required(f, "host"))
    }
    if f.command == "STOMP" && offered == [V10] {
      raise Invalid("STOMP command requires a modern offered version")
    }
    if f.header("receipt") != None {
      raise Invalid("CONNECT receipt forbidden")
    }
    let (cx, cy) = heartbeat_pair(f.header("heart-beat").unwrap_or("0,0"))
    if offered == [V10] && (cx != 0 || cy != 0) {
      raise Invalid("STOMP 1.0 has no heartbeat negotiation")
    }
    self.offered = offered
    self.decoder.expect_versions(offered)
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
      let id = self.subscription_key(f)
      let destination = required(f, "destination")
      if self.version == Some(V10) {
        for item in self.destinations {
          if item.1 == destination &&
            (f.header("id") == None || item.0.has_prefix("destination:")) {
            raise Invalid("ambiguous STOMP 1.0 destination subscription")
          }
        }
      }
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
        "auto" | "client" => ()
        "client-individual" =>
          if self.version == Some(V10) {
            raise Invalid("client-individual requires STOMP 1.1 or 1.2")
          }
        _ => raise Invalid("invalid ack mode")
      }
    }
    "UNSUBSCRIBE" => {
      let id = self.unsubscribe_key(f)
      if self.subscription_mode(id) == None {
        raise Invalid("unknown subscription")
      }
      for pending in self.unsubscribing {
        if pending.0 == id {
          raise Invalid("unsubscribe already pending")
        }
      }
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
      if f.command == "NACK" && self.version == Some(V10) {
        raise Invalid("NACK requires STOMP 1.1 or 1.2")
      }
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
    "SUBSCRIBE" => {
      let id = self.subscription_key(f)
      self.subscriptions.push((id, f.header("ack").unwrap_or("auto")))
      self.destinations.push((id, required(f, "destination")))
    }
    "UNSUBSCRIBE" => {
      let id = self.unsubscribe_key(f)
      match f.header("receipt") {
        Some(receipt) =>
          // Keep the slot/mode until the ordered receipt fences earlier MESSAGEs.
          self.unsubscribing.push((id, receipt))
        None => self.remove_subscription(id)
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
    if f.command != "CONNECTED" {
      raise Invalid("expected CONNECTED")
    }
    let version = parse_version(f.header("version").unwrap_or("1.0"))
    if !self.offered.contains(version) {
      raise Invalid("invalid version negotiation")
    }
    self.version = Some(version)
    if version != V10 {
      let (sx, sy) = heartbeat_pair(f.header("heart-beat").unwrap_or("0,0"))
      self.clock = Some(
        HeartbeatClock::new(negotiate_heartbeat(self.cx, self.cy, sx, sy), now),
      )
    }
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
      let sub = if self.version == Some(V10) {
        match f.header("subscription") {
          Some(id) => "id:" + id
          None => self.destination_key(required(f, "destination"))
        }
      } else {
        required(f, "subscription")
      }
      let mode = match self.subscription_mode(sub) {
        Some(m) => m
        None => raise Invalid("unknown MESSAGE subscription")
      }
      if mode != "auto" {
        let id = required(
          f,
          if self.version == Some(V12) {
            "ack"
          } else {
            "message-id"
          },
        )
        if self.deliveries.length() >= self.max_pending {
          raise Invalid("pending delivery limit")
        }
        for d in self.deliveries {
          if d.id == id && (self.version != Some(V11) || d.subscription == sub) {
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
      for i = self.unsubscribing.length() - 1; i >= 0; i = i - 1 {
        if self.unsubscribing[i].1 == id {
          self.remove_subscription(self.unsubscribing[i].0)
          ignore(self.unsubscribing.remove(i))
        }
      }
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
  // A terminal poll is inert; every live-state poll still advances caller time.
  if self.state == Closed {
    return b""
  }
  self.advance(now)
  if self.state != Active {
    return b""
  }
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

///|
/// None before negotiation; remains inspectable after close.
pub fn Client::version(self : Client) -> Version? {
  self.version
}

///|
fn Client::subscription_key(
  self : Client,
  frame : Frame,
) -> String raise ProtocolError {
  if self.version == Some(V10) {
    match frame.header("id") {
      Some(_) => "id:" + required(frame, "id")
      None => "destination:" + required(frame, "destination")
    }
  } else {
    required(frame, "id")
  }
}

///|
fn Client::destination_key(
  self : Client,
  destination : String,
) -> String raise ProtocolError {
  let mut key : String? = None
  for item in self.destinations {
    if item.1 == destination {
      if key != None {
        raise Invalid("ambiguous STOMP 1.0 MESSAGE destination")
      }
      key = Some(item.0)
    }
  }
  match key {
    Some(id) => id
    None => raise Invalid("unknown subscription destination")
  }
}

///|
fn Client::unsubscribe_key(
  self : Client,
  frame : Frame,
) -> String raise ProtocolError {
  if self.version == Some(V10) && frame.header("id") == None {
    self.destination_key(required(frame, "destination"))
  } else {
    self.subscription_key(frame)
  }
}
