fn active(capacity? : Int = 256, max_pending? : Int = 1024, heart? : String = "0,0") -> Client raise ProtocolError {
  let c = Client::new(capacity~, max_pending~)
  ignore(c.send(Frame::new("CONNECT", [("host", "localhost"), ("accept-version", "1.2"), ("heart-beat", heart)]), 0))
  ignore(c.receive(b"CONNECTED\nversion:1.2\nheart-beat:10,10\n\n\x00", 0))
  c
}
fn sub(c : Client, id : String, mode : String) -> Unit raise ProtocolError {
  ignore(c.send(Frame::new("SUBSCRIBE", [("destination", "tasks"), ("id", id), ("ack", mode)]), 0))
}
fn message(c : Client, sub : String, ack : String) -> Unit raise ProtocolError {
  ignore(c.receive(encode(Frame::new("MESSAGE", [("subscription", sub), ("destination", "tasks"), ("message-id", ack), ("ack", ack)], body=b"job")), 0))
}

test "connection negotiation validates required version and host" {
  let c = Client::new()
  assert_eq(c.state(), Fresh)
  assert_true(try { ignore(c.send(Frame::new("SEND", [("destination", "x")]), 0)); false } catch { _ => true })
  assert_eq(c.state(), Fresh)
  assert_true(try { ignore(c.send(Frame::new("CONNECT", [("accept-version", "1.2")]), 0)); false } catch { _ => true })
  ignore(c.send(Frame::new("STOMP", [("host", "local"), ("accept-version", "1.2")]), 0))
  assert_eq(c.state(), Connecting)
  assert_true(try { ignore(c.receive(b"CONNECTED\nversion:1.1\n\n\x00", 0)); false } catch { _ => true })
  assert_eq(c.state(), Closed)
}

test "active subscribe unsubscribe send and command validation" {
  let c = active()
  sub(c, "s", "auto")
  assert_true(try { sub(c, "s", "auto"); false } catch { _ => true })
  assert_true(try { sub(c, "t", "invalid"); false } catch { _ => true })
  message(c, "s", "a")
  assert_eq(c.pending_deliveries(), 0)
  ignore(c.send(Frame::new("SEND", [("destination", "tasks")], body=b"job"), 0))
  ignore(c.send(Frame::new("UNSUBSCRIBE", [("id", "s")]), 0))
  assert_true(try { ignore(c.send(Frame::new("UNSUBSCRIBE", [("id", "s")]), 0)); false } catch { _ => true })
  assert_true(try { ignore(c.send(Frame::new("CONNECTED", [("version", "1.2")]), 0)); false } catch { _ => true })
  assert_eq(c.state(), Active)
}

test "DISCONNECT waits for its receipt forbids sends and then releases resources" {
  let c = active()
  sub(c, "s", "client")
  message(c, "s", "a")
  ignore(c.send(Frame::new("DISCONNECT", [("receipt", "bye")]), 0))
  assert_eq(c.state(), Disconnecting)
  assert_eq(c.pending_receipts(), 1)
  assert_true(try { ignore(c.send(Frame::new("SEND", [("destination", "x")]), 0)); false } catch { _ => true })
  assert_eq(c.receive(b"RECEIPT\nreceipt-id:bye\n\n\x00", 0), [Receipt("bye")])
  assert_eq(c.state(), Closed)
  assert_eq(c.pending_deliveries(), 0)
  assert_eq(c.pending_receipts(), 0)
}

test "ERROR EOF and unsolicited frames close connection" {
  let c = active()
  assert_eq(c.receive(b"ERROR\nmessage:denied\n\n\x00", 0).length(), 1)
  assert_eq(c.state(), Closed)
  let c = active()
  assert_true(try { ignore(c.receive(b"RECEIPT\nreceipt-id:unknown\n\n\x00", 0)); false } catch { _ => true })
  assert_eq(c.state(), Closed)
  let c = active()
  ignore(c.receive(b"MESS", 0))
  assert_true(try { c.end(); false } catch { _ => true })
  assert_eq(c.state(), Closed)
  let c = active()
  c.end()
  assert_eq(c.state(), Closed)
}

test "receipts require unique pending ids and correlate independently" {
  let c = active(capacity=1)
  ignore(c.send(Frame::new("SEND", [("destination", "x"), ("receipt", "r")]), 0))
  assert_true(try { ignore(c.send(Frame::new("SEND", [("destination", "x"), ("receipt", "r")]), 0)); false } catch { _ => true })
  assert_true(try { ignore(c.send(Frame::new("SEND", [("destination", "x"), ("receipt", "s")]), 0)); false } catch { _ => true })
  assert_eq(c.receive(b"RECEIPT\nreceipt-id:r\n\n\x00", 0), [Receipt("r")])
  assert_eq(c.pending_receipts(), 0)
}

test "client heartbeat tick and partial data keepalive" {
  let c = active(heart="10,10")
  assert_eq(c.tick(9), b"")
  assert_eq(c.tick(10), b"\n")
  ignore(c.receive(b"M", 100))
  assert_eq(c.tick(110), b"\n")
  assert_true(try { ignore(c.tick(211)); false } catch { _ => true })
  assert_eq(c.state(), Closed)
}
