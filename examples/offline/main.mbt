// Offline walkthrough: supplied server frames illustrate API usage, not broker proof.

///|
fn run() -> Unit raise @stomp.ProtocolError {
  let c = @stomp.Client::new()
  ignore(c.send(@stomp.connect("localhost"), 0))
  ignore(c.receive(b"CONNECTED\nversion:1.2\n\n\x00", 0))
  ignore(
    c.send(
      @stomp.subscribe("worker", "/queue/tasks", ack="client-individual"),
      0,
    ),
  )
  ignore(c.send(@stomp.send_message("/queue/tasks", b"resize\x00image"), 0))
  let received = c.receive(
    b"MESSAGE\nsubscription:worker\nmessage-id:job-1\ndestination:/queue/tasks\nack:a1\ncontent-length:12\n\nresize\x00image\x00",
    0,
  )
  if received.length() != 1 {
    abort("missing task")
  }
  println("1 task producer/consumer: binary task accepted")
  ignore(c.send(@stomp.acknowledge("a1"), 0))
  ignore(
    c.receive(
      b"MESSAGE\nsubscription:worker\nmessage-id:job-2\ndestination:/queue/tasks\nack:a2\n\nretry\x00",
      0,
    ),
  )
  ignore(c.send(@stomp.acknowledge("a2", negative=true), 0))
  if c.pending_deliveries() != 0 {
    abort("unsettled task")
  }
  println("2 reliable processing: ACK success and NACK failure sent")
  ignore(c.send(@stomp.begin_transaction("discard"), 0))
  ignore(
    c.send(
      @stomp.send_message("/queue/tasks", b"discard", transaction="discard"),
      0,
    ),
  )
  ignore(c.send(@stomp.finish_transaction("discard", commit=false), 0))
  ignore(c.send(@stomp.begin_transaction("publish"), 0))
  ignore(
    c.send(
      @stomp.send_message("/queue/tasks", b"publish", transaction="publish"),
      0,
    ),
  )
  ignore(c.send(@stomp.finish_transaction("publish"), 0))
  println("3 transactions: staged send aborted, second transaction committed")
  ignore(c.send(@stomp.unsubscribe("worker"), 0))
  ignore(c.send(@stomp.disconnect("bye"), 0))
  ignore(c.receive(b"RECEIPT\nreceipt-id:bye\n\n\x00", 0))
  match c.state() {
    Closed => ()
    _ => abort("connection not closed")
  }
  println("disconnect receipt consumed, connection closed")
}

///|
fn main {
  run() catch {
    _ => abort("offline example failed")
  }
}
