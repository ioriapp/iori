#[cfg(any(windows, target_os = "linux"))]
pub mod askpass;
#[cfg_attr(
    not(any(windows, target_os = "linux")),
    expect(
        dead_code,
        reason = "SSH config is compiled and linted on every desktop; session runtime targets Windows and Linux"
    )
)]
mod config;
#[cfg_attr(
    not(any(windows, target_os = "linux")),
    expect(
        dead_code,
        reason = "SSH output is compiled and linted on every desktop; session runtime targets Windows and Linux"
    )
)]
pub(super) mod output;
#[cfg(any(windows, target_os = "linux"))]
pub(super) mod platform;
#[cfg(any(windows, target_os = "linux"))]
mod session;
#[cfg(any(windows, target_os = "linux"))]
pub use session::*;

#[cfg(any(windows, target_os = "linux"))]
mod remote;
#[cfg(any(windows, target_os = "linux"))]
mod windows;
