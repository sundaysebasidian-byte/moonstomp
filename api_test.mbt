///|
test "external caller configures bounded decoder and observes a binary frame" {
  let limits = @moonstomp.Limits::new(max_body=4, max_events=2)
  let d = @moonstomp.Decoder::new(limits~)
  let f = @moonstomp.Frame::new(
    "SEND",
    [("destination", "tasks")],
    body=b"a\x00b",
  )
  let events = d.feed(@moonstomp.encode(f))
  match events[0] {
    Frame(parsed) => {
      assert_eq(parsed.command, "SEND")
      assert_eq(parsed.header("destination"), Some("tasks"))
      assert_eq(parsed.body, b"a\x00b")
    }
    _ => fail("expected frame")
  }
  d.end()
  assert_true(
    try {
      ignore(d.feed(b"\n"))
      false
    } catch {
      _ => true
    },
  )
}

///|
test "external client uses convenience API and negotiates heartbeat" {
  let c = @moonstomp.Client::new()
  ignore(c.send(@moonstomp.connect("localhost", heartbeat="10,20"), 0))
  ignore(c.receive(b"CONNECTED\nversion:1.2\nheart-beat:20,10\n\n\x00", 0))
  assert_eq(c.tick(10), b"\n")
  ignore(c.send(@moonstomp.subscribe("s", "tasks"), 10))
  ignore(c.send(@moonstomp.send_message("tasks", b"job"), 10))
  c.fail()
  match c.state() {
    Closed => ()
    _ => fail("must close")
  }
}
