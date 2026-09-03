// Re-export all events types from the parent crate's events module.
// This exists because monolith.rs declares `pub mod events;` and references
// `events::*` throughout. Rather than rewriting every reference, we provide
// a thin re-export shim.
pub use crate::events::*;
