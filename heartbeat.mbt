pub struct HeartbeatPlan {
  send_ms : Int
  receive_ms : Int
} derive(Debug, Eq)

pub fn negotiate_heartbeat(cx : Int, cy : Int, sx : Int, sy : Int) -> HeartbeatPlan raise ProtocolError {
  if cx < 0 || cy < 0 || sx < 0 || sy < 0 { raise Invalid("negative heartbeat") }
  { send_ms: if cx == 0 || sy == 0 { 0 } else { Int::max(cx, sy) },
    receive_ms: if sx == 0 || cy == 0 { 0 } else { Int::max(sx, cy) } }
}

fn heartbeat_pair(s : String) -> (Int, Int) raise ProtocolError {
  let pieces = s.split(",").to_array()
  if pieces.length() != 2 { raise Invalid("invalid heartbeat pair") }
  (decimal(pieces[0].to_string(), 2147483647), decimal(pieces[1].to_string(), 2147483647))
}

/// Time is monotonic milliseconds supplied by the transport; no hidden wall clock.
pub struct HeartbeatClock {
  plan : HeartbeatPlan
  tolerance_ms : Int64
  mut sent : Int64
  mut received : Int64
  mut now : Int64
}

pub fn HeartbeatClock::new(plan : HeartbeatPlan, now : Int64, tolerance_ms? : Int64 = 100) -> HeartbeatClock raise ProtocolError {
  if now < 0 || tolerance_ms < 0 || tolerance_ms > 2147483647L { raise Invalid("invalid clock") }
  { plan, tolerance_ms, sent: now, received: now, now }
}

fn HeartbeatClock::advance(self : HeartbeatClock, now : Int64) -> Unit raise ProtocolError {
  if now < self.now { raise Invalid("clock moved backwards") }
  self.now = now
}

pub fn HeartbeatClock::sent_data(self : HeartbeatClock, now : Int64) -> Unit raise ProtocolError {
  self.advance(now)
  self.sent = now
}

pub fn HeartbeatClock::received_data(self : HeartbeatClock, now : Int64) -> Unit raise ProtocolError {
  self.advance(now)
  self.received = now
}

/// (send heartbeat, peer timed out); a due beat is marked sent only after write.
pub fn HeartbeatClock::poll(self : HeartbeatClock, now : Int64) -> (Bool, Bool) raise ProtocolError {
  self.advance(now)
  (self.plan.send_ms > 0 && now - self.sent >= self.plan.send_ms.to_int64(),
   self.plan.receive_ms > 0 && now - self.received > self.plan.receive_ms.to_int64() + self.tolerance_ms)
}
