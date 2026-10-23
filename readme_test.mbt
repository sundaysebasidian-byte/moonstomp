///|
/// Keeps the README snippet compiling and correct.
test "README: a MESSAGE split across two reads" {
  let client = @moonstomp.Client::new()
  let _connect_bytes = client.send(@moonstomp.connect("localhost"), 0)
  ignore(client.receive(b"CONNECTED\nversion:1.2\n\n\x00", 0))
  assert_eq(client.version(), Some(@moonstomp.V12))
  ignore(
    client.send(
      @moonstomp.subscribe("sub-1", "/queue/jobs", ack="client-individual"),
      0,
    ),
  )
  let first = client.receive(
    b"MESSAGE\nsubscription:sub-1\nmessage-id:m1\ndestination:/queue/jobs\nack:a1\ncontent-len",
    0,
  )
  assert_eq(first.length(), 0)
  let events = client.receive(b"gth:5\n\nhello\x00", 0)
  match events[0] {
    @moonstomp.Message(frame) => assert_eq(frame.body, b"hello")
    _ => fail("expected a MESSAGE")
  }
  ignore(client.send(@moonstomp.acknowledge("a1"), 0))
  assert_eq(client.pending_deliveries(), 0)
}
