/// Convenience constructors keep destinations opaque; broker semantics are external.
pub fn connect(host : String, heartbeat? : String = "0,0") -> Frame { Frame::new("CONNECT", [("accept-version", "1.2"), ("host", host), ("heart-beat", heartbeat)]) }
pub fn send_message(destination : String, body : Bytes, transaction? : String = "", receipt? : String = "") -> Frame {
  let h = [("destination", destination), ("content-type", "application/octet-stream")]
  if transaction != "" { h.push(("transaction", transaction)) }
  if receipt != "" { h.push(("receipt", receipt)) }
  Frame::new("SEND", h, body~)
}
pub fn subscribe(id : String, destination : String, ack? : String = "auto") -> Frame { Frame::new("SUBSCRIBE", [("id", id), ("destination", destination), ("ack", ack)]) }
pub fn unsubscribe(id : String) -> Frame { Frame::new("UNSUBSCRIBE", [("id", id)]) }
pub fn acknowledge(id : String, negative? : Bool = false, transaction? : String = "") -> Frame {
  let h = [("id", id)]
  if transaction != "" { h.push(("transaction", transaction)) }
  Frame::new(if negative { "NACK" } else { "ACK" }, h)
}
pub fn begin_transaction(id : String) -> Frame { Frame::new("BEGIN", [("transaction", id)]) }
pub fn finish_transaction(id : String, commit? : Bool = true) -> Frame { Frame::new(if commit { "COMMIT" } else { "ABORT" }, [("transaction", id)]) }
pub fn disconnect(receipt : String) -> Frame { Frame::new("DISCONNECT", [("receipt", receipt)]) }
