///|
fn audit30_join(a : Bytes, b : Bytes) -> Bytes {
  let out = a.to_array()
  for x in b {
    out.push(x)
  }
  Bytes::from_array(out)
}

///|
test "audit30 R01 outbound expansion slots and exact raw-byte budgets" {
  for v in [V10, V11, V12] {
    for count in [2046, 2047] {
      let c = review_client(v)
      let value = String::from_array(
        Array::make(count - 1, if v == V10 { 'a' } else { ':' }),
      )
      let wire = c.send(
        Frame::new("SEND", [("destination", "q"), ("x", value)]),
        0,
      )
      let events = Decoder::new(version=v).feed(wire)
      assert_eq(events.length(), 1)
    }
    let c = review_client(v)
    let too_long = String::from_array(Array::make(1024, 'é'))
    assert_true(
      try {
        ignore(
          c.send(Frame::new("SEND", [("destination", "q"), ("x", too_long)]), 0),
        )
        false
      } catch {
        _ => true
      },
    )
    assert_eq(c.state(), Active)
    let hs : Array[(String, String)] = [("destination", "q")]
    for i = 0; i < 127; i = i + 1 {
      hs.push(("x", i.to_string()))
    }
    ignore(c.send(Frame::new("SEND", hs), 0))
    assert_true(
      try {
        ignore(c.send(Frame::new("SEND", hs, body=b"x"), 0))
        false
      } catch {
        _ => true
      },
    )
    hs[127] = ("content-length", "1")
    ignore(c.send(Frame::new("SEND", hs, body=b"x"), 0))
    assert_eq(c.state(), Active)
  }
}

///|
test "audit30 R02 client directions terminal states and forbidden bodies" {
  let commands = [
    "CONNECT", "STOMP", "CONNECTED", "SEND", "SUBSCRIBE", "UNSUBSCRIBE", "ACK", "NACK",
    "BEGIN", "COMMIT", "ABORT", "DISCONNECT", "MESSAGE", "RECEIPT", "ERROR",
  ]
  for v in [V10, V11, V12] {
    for cmd in commands {
      let c = review_client(v)
      c.fail()
      assert_true(
        try {
          ignore(c.send(Frame::new(cmd, []), 0))
          false
        } catch {
          _ => true
        },
      )
      assert_eq(c.state(), Closed)
      let connecting = Client::new()
      ignore(connecting.send(connect_versions("localhost", [v]), 0))
      assert_true(
        try {
          ignore(connecting.send(Frame::new(cmd, []), 0))
          false
        } catch {
          _ => true
        },
      )
      assert_eq(connecting.state(), Connecting)
      let encoded = try {
        ignore(encode_versioned(Frame::new(cmd, [], body=b"x"), v))
        true
      } catch {
        _ => false
      }
      assert_eq(encoded, cmd == "SEND" || cmd == "MESSAGE" || cmd == "ERROR")
    }
    for cmd in ["CONNECTED", "MESSAGE", "RECEIPT", "ERROR", "CONNECT", "STOMP"] {
      let c = review_client(v)
      assert_true(
        try {
          ignore(c.send(Frame::new(cmd, []), 0))
          false
        } catch {
          _ => true
        },
      )
      assert_eq(c.state(), Active)
    }
  }
}

///|
test "audit30 R03 zero padded decimal body lengths at byte cut points" {
  for v in [V10, V11, V12] {
    for zeros in [0, 1, 16, 2048] {
      let length = String::from_array(Array::make(zeros, '0')) + "3"
      let wire = audit30_join(
        @utf8.encode("MESSAGE\ncontent-length:" + length + "\n\n"),
        b"a\x00\xff\x00",
      )
      for
        cut in [
          0,
          wire.length() - 4,
          wire.length() - 3,
          wire.length() - 2,
          wire.length() - 1,
          wire.length(),
        ] {
        let d = Decoder::new(version=v)
        let events = d.feed(slice(wire, 0, cut))
        for e in d.feed(slice(wire, cut, wire.length())) {
          events.push(e)
        }
        d.end()
        assert_eq(events.length(), 1)
        match events[0] {
          Frame(f) => assert_eq(f.body, b"a\x00\xff")
          _ => fail("frame expected")
        }
      }
    }
  }
}

///|
test "audit30 R04 every EOF prefix and invalid batch atomicity" {
  for v in [V10, V11, V12] {
    let wire = encode_versioned(
      Frame::new("SEND", [("x", "a:b\\c")], body=b"a\x00\xff"),
      v,
    )
    for cut = 0; cut <= wire.length(); cut = cut + 1 {
      let d = Decoder::new(version=v)
      ignore(d.feed(slice(wire, 0, cut)))
      let complete = try {
        d.end()
        true
      } catch {
        _ => false
      }
      assert_eq(complete, cut == 0 || cut == wire.length())
      if !complete {
        assert_eq(d.line.length(), 0)
        assert_eq(d.body.length(), 0)
      }
    }
    let d = Decoder::new(version=v)
    assert_true(
      try {
        ignore(d.feed(audit30_join(wire, b"BOGUS\n\n\x00")))
        false
      } catch {
        _ => true
      },
    )
    assert_true(d.failed)
    assert_true(
      try {
        ignore(d.feed(wire))
        false
      } catch {
        _ => true
      },
    )
  }
}

///|
test "audit30 R05 frame constructors and decoder outputs own header arrays" {
  for v in [V10, V11, V12] {
    let hs = [("x", "first")]
    let f = Frame::new("SEND", hs, body=b"first")
    hs[0] = ("x", "mutated")
    assert_eq(f.header("x"), Some("first"))
    let d = Decoder::new(version=v)
    let a = d.feed(encode_versioned(f, v))
    ignore(
      d.feed(
        encode_versioned(
          Frame::new("SEND", [("x", "second")], body=b"second"),
          v,
        ),
      ),
    )
    match a[0] {
      Frame(out) => {
        assert_eq(out.header("x"), Some("first"))
        assert_eq(out.body, b"first")
        out.headers.push(("local", "edit"))
      }
      _ => fail("frame expected")
    }
    assert_eq(d.headers.length(), 0)
    assert_eq(f.headers.length(), 1)
  }
}

///|
test "audit30 R06 ERROR before handshake and while controls pending" {
  for v in [V10, V11, V12] {
    for active_state in [false, true] {
      let c = if active_state {
        review_client(v)
      } else {
        let c = Client::new()
        ignore(c.send(connect_versions("localhost", [v]), 0))
        c
      }
      if active_state {
        ignore(c.send(begin_transaction("T"), 0))
        ignore(c.send(send_message("q", b"x", receipt="R"), 0))
      }
      let error = Frame::new(
        "ERROR",
        [
          ("message", "denied"),
          ("receipt-id", "not-registered"),
          ("content-length", "8"),
        ],
        body=b"binary\x00\xff",
      )
      let events = c.receive(encode_versioned(error, v), 0)
      assert_eq(events, [ServerError(error)])
      assert_eq(c.state(), Closed)
      assert_eq(c.pending_receipts(), 0)
      assert_eq(c.transactions.length(), 0)
    }
  }
}

///|
test "audit30 R07 duplicate delivery identity differs by protocol" {
  for v in [V10, V11, V12] {
    let c = review_client(v)
    for sid in ["a", "b"] {
      ignore(c.send(subscribe_versioned(v, sid, id=sid, ack="client"), 0))
    }
    ignore(review_delivery(c, v, "a", "same"))
    let accepted = try {
      ignore(review_delivery(c, v, "b", "same"))
      true
    } catch {
      _ => false
    }
    assert_eq(accepted, v == V11)
    if v == V11 {
      assert_eq(c.pending_deliveries(), 2)
      assert_true(
        try {
          ignore(review_delivery(c, v, "a", "same"))
          false
        } catch {
          _ => true
        },
      )
    }
    assert_eq(c.state(), Closed)
  }
}

///|
test "audit30 R08 unsubscribe retains transaction staged deliveries" {
  for v in [V10, V11, V12] {
    for commit in [false, true] {
      let c = review_client(v)
      ignore(c.send(subscribe_versioned(v, "tasks", id="s", ack="client"), 0))
      let f = review_delivery(c, v, "s", "a")
      ignore(c.send(begin_transaction("T"), 0))
      ignore(c.send(acknowledge_message(v, f, transaction="T"), 0))
      ignore(
        c.send(Frame::new("UNSUBSCRIBE", [("id", "s"), ("receipt", "U")]), 0),
      )
      ignore(
        c.receive(
          encode_versioned(Frame::new("RECEIPT", [("receipt-id", "U")]), v),
          0,
        ),
      )
      assert_eq(c.subscriptions.length(), 0)
      assert_eq(c.pending_deliveries(), 1)
      ignore(c.send(finish_transaction("T", commit~), 0))
      assert_eq(c.pending_deliveries(), if commit { 0 } else { 1 })
      if !commit {
        ignore(c.send(acknowledge_message(v, f), 0))
      }
      ignore(c.send(subscribe_versioned(v, "new", id="s", ack="auto"), 0))
    }
  }
}

///|
test "audit30 R09 simultaneous opposite dispositions stay transaction scoped" {
  for v in [V11, V12] {
    for commit_a in [false, true] {
      let c = review_client(v)
      for sid in ["a", "b"] {
        ignore(c.send(subscribe_versioned(v, sid, id=sid, ack="client"), 0))
      }
      let a1 = review_delivery(c, v, "a", "a1")
      let b1 = review_delivery(c, v, "b", "b1")
      let a2 = review_delivery(c, v, "a", "a2")
      let b2 = review_delivery(c, v, "b", "b2")
      for tx in ["A", "B"] {
        ignore(c.send(begin_transaction(tx), 0))
      }
      ignore(c.send(acknowledge_message(v, a2, transaction="A"), 0))
      ignore(
        c.send(acknowledge_message(v, b2, negative=true, transaction="B"), 0),
      )
      ignore(c.send(finish_transaction("A", commit=commit_a), 0))
      ignore(c.send(finish_transaction("B", commit=!commit_a), 0))
      assert_eq(c.pending_deliveries(), 2)
      let first = if commit_a { b1 } else { a1 }
      let last = if commit_a { b2 } else { a2 }
      ignore(c.send(acknowledge_message(v, first), 0))
      ignore(c.send(acknowledge_message(v, last), 0))
      assert_eq(c.pending_deliveries(), 0)
    }
  }
}

///|
test "audit30 R10 acknowledgement token required only in modern manual mode" {
  for v in [V10, V11, V12] {
    for mode in ["auto", "client"] {
      for token in [None, Some(""), Some("ack-token")] {
        let c = review_client(v)
        ignore(c.send(subscribe_versioned(v, "q", id="s", ack=mode), 0))
        let hs = [
          ("destination", "q"),
          ("subscription", "s"),
          ("message-id", "m"),
        ]
        match token {
          Some(s) => hs.push(("ack", s))
          None => ()
        }
        let success = try {
          ignore(c.receive(encode_versioned(Frame::new("MESSAGE", hs), v), 0))
          true
        } catch {
          _ => false
        }
        assert_eq(
          success,
          v != V12 || mode == "auto" || token == Some("ack-token"),
        )
        if success {
          assert_eq(c.pending_deliveries(), if mode == "auto" { 0 } else { 1 })
        }
      }
    }
  }
}
