///|
fn message_frame(index : Int, body : Bytes) -> @stomp.Frame {
  @stomp.Frame::new(
    "MESSAGE",
    [
      ("destination", "/queue/jobs"),
      ("message-id", "m-\{index}"),
      ("subscription", "s-1"),
    ],
    body~,
  )
}

///|
fn message_stream(
  count : Int,
  body : Bytes,
) -> Bytes raise @stomp.ProtocolError {
  let out : Array[Byte] = []
  for i = 0; i < count; i = i + 1 {
    for byte in @stomp.encode(message_frame(i, body)) {
      out.push(byte)
    }
  }
  Bytes::from_array(out)
}

///|
fn split(stream : Bytes, size : Int) -> Array[Bytes] {
  let bytes = stream.to_array()
  let chunks = []
  let mut start = 0
  while start < bytes.length() {
    let end = Int::min(bytes.length(), start + size)
    chunks.push(Bytes::from_array(bytes[start:end].to_owned()))
    start = end
  }
  chunks
}

///|
/// Returns the number of decoded frames; aborts if the fixed stream is rejected.
fn decode_chunks(chunks : Array[Bytes], limits : @stomp.Limits) -> Int {
  try {
    let decoder = @stomp.Decoder::new(limits~)
    let mut frames = 0
    for chunk in chunks {
      frames = frames + decoder.feed(chunk).length()
    }
    decoder.end()
    frames
  } catch {
    _ => abort("benchmark stream must decode")
  }
}

///|
test "encode and decode 100 MESSAGE frames with 1 KiB bodies" (b : @bench.T) {
  let body = Bytes::make(1024, b'x')
  let stream = message_stream(100, body)
  let limits = @stomp.Limits::new(max_events=100)
  let whole = [stream]
  let small = split(stream, 64)
  assert_eq(decode_chunks(whole, limits), 100)
  assert_eq(decode_chunks(small, limits), 100)
  println("stream: frames=100 body=1024B wire=\{stream.length()}B")
  b.bench(
    name="encode_100x1KiB",
    fn() {
      for i = 0; i < 100; i = i + 1 {
        b.keep(
          @stomp.encode(message_frame(i, body)) catch {
            _ => abort("benchmark frame must encode")
          },
        )
      }
    },
    count=5,
  )
  b.bench(
    name="decode_100x1KiB_one_buffer",
    fn() { b.keep(decode_chunks(whole, limits)) },
    count=5,
  )
  b.bench(
    name="decode_100x1KiB_64B_chunks",
    fn() { b.keep(decode_chunks(small, limits)) },
    count=5,
  )
}

///|
fn client_receive(stream : Bytes) -> Array[@stomp.ClientEvent] {
  try {
    let client = @stomp.Client::new()
    ignore(client.send(@stomp.connect("localhost"), 0))
    ignore(client.receive(b"CONNECTED\nversion:1.2\nheart-beat:0,0\n\n\x00", 0))
    ignore(client.send(@stomp.subscribe("s-1", "/queue/jobs"), 0))
    client.receive(stream, 1)
  } catch {
    _ => abort("benchmark session must accept the stream")
  }
}

///|
test "client session receives 100 MESSAGE frames" (b : @bench.T) {
  let stream = message_stream(100, Bytes::make(1024, b'x'))
  assert_eq(client_receive(stream).length(), 100)
  b.bench(
    name="client_receive_100x1KiB",
    fn() { b.keep(client_receive(stream)) },
    count=5,
  )
}
