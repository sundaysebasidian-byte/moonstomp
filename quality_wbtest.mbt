///|
test "inactive live ticks validate monotonic time and close on regression" {
  let c = Client::new()
  ignore(c.send(connect("local"), 100))
  assert_true(try { ignore(c.tick(99)); false } catch { _ => true })
  assert_eq(c.state(), Closed)
  let c = Client::new()
  assert_true(try { ignore(c.tick(-1)); false } catch { _ => true })
  assert_eq(c.state(), Closed)
  let c = active()
  ignore(c.send(disconnect("bye"), 10))
  assert_eq(c.pending_receipts(), 1)
  assert_true(try { ignore(c.tick(9)); false } catch { _ => true })
  assert_eq(c.state(), Closed)
  assert_eq(c.pending_receipts(), 0)
}

///|
test "negotiation polls advance time without sending beats and terminal polls are inert" {
  let c = Client::new()
  ignore(c.send(connect("local", heartbeat="10,10"), 100))
  assert_eq(c.tick(101), b"")
  assert_true(try { ignore(c.receive(b"CONNECTED\nversion:1.2\n\n\x00", 100)); false } catch { _ => true })
  assert_eq(c.state(), Closed)
  assert_eq(c.tick(-1), b"")
  let c = Client::new()
  assert_eq(c.tick(10), b"")
  assert_true(try { ignore(c.send(connect("local"), 9)); false } catch { _ => true })
  assert_eq(c.state(), Fresh)
  ignore(c.send(connect("local"), 10))
  assert_eq(c.tick(10), b"")
  ignore(c.receive(b"CONNECTED\nversion:1.2\n\n\x00", 10))
  assert_eq(c.state(), Active)
  c.fail()
}
