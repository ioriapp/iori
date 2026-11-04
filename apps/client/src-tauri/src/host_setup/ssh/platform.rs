use std::path::PathBuf;
use tokio::process::Command;

#[cfg(windows)]
pub fn command() -> Command {
    let system = std::env::var_os("SystemRoot")
        .map(PathBuf::from)
        .map(|root| root.join("System32/OpenSSH/ssh.exe"));
    let mut command = Command::new(
        system
            .filter(|path| path.is_file())
            .unwrap_or_else(|| "ssh".into()),
    );
    command.creation_flags(0x08000000);
    command
}
#[cfg(windows)]
pub fn home() -> Result<PathBuf, String> {
    std::env::var_os("USERPROFILE")
        .map(PathBuf::from)
        .ok_or_else(|| "Could not find the user profile".into())
}

#[cfg(target_os = "linux")]
pub fn command() -> Command {
    Command::new("ssh")
}
#[cfg(target_os = "linux")]
pub fn home() -> Result<PathBuf, String> {
    std::env::var_os("HOME")
        .map(PathBuf::from)
        .ok_or_else(|| "Could not find the user profile".into())
}
pub fn missing_client() -> &'static str {
    #[cfg(windows)]
    return "OpenSSH Client was not found. Add OpenSSH Client in Windows Settings → Optional features.";
    #[cfg(target_os = "linux")]
    return "OpenSSH Client was not found. Install OpenSSH Client and try again.";
}
