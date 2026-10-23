///|
/// Wire semantics; legacy constructors continue to default to V12.
pub(all) enum Version {
  V10
  V11
  V12
} derive(Debug, Eq)

///|
pub fn Version::wire(self : Version) -> String {
  match self {
    V10 => "1.0"
    V11 => "1.1"
    V12 => "1.2"
  }
}

///|
pub fn parse_version(value : String) -> Version raise ProtocolError {
  match value {
    "1.0" => V10
    "1.1" => V11
    "1.2" => V12
    _ => raise Invalid("unsupported STOMP version")
  }
}

///|
fn offered_versions(value : String) -> Array[Version] raise ProtocolError {
  let out : Array[Version] = []
  for part in value.split(",") {
    let version = parse_version(part.to_owned())
    if out.contains(version) {
      raise Invalid("duplicate offered version")
    }
    out.push(version)
  }
  if out.is_empty() || out.length() > 3 {
    raise Invalid("invalid offered versions")
  }
  out
}

///|
pub extend Version with @debug.Debug::{to_repr}

///|
pub extend Version with Eq::{equal, not_equal}
