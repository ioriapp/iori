use serde_json::json;
use std::io::{BufRead, Write};
use zeroize::Zeroizing;

// OpenSSH invokes the same executable with just its prompt argument. This runs
// before Tauri and the single-instance plugin, so no second GUI is opened.
pub fn run() -> bool {
    let Ok(address) = std::env::var("IORI_SSH_ASKPASS_ADDRESS") else {
        return false;
    };
    let result = (|| -> Result<(), Box<dyn std::error::Error>> {
        let token = Zeroizing::new(std::env::var("IORI_SSH_ASKPASS_TOKEN")?);
        let mut socket = std::net::TcpStream::connect(address)?;
        let prompt = std::env::args().nth(1).ok_or("Missing SSH prompt")?;
        let body = Zeroizing::new(serde_json::to_string(
            &json!({"token": *token, "prompt": prompt, "notification": std::env::var("SSH_ASKPASS_PROMPT").as_deref() == Ok("none")}),
        )?);
        writeln!(socket, "{}", body.as_str())?;
        let mut answer = Zeroizing::new(String::new());
        std::io::BufReader::new(socket).read_line(&mut answer)?;
        let answer: Option<String> = serde_json::from_str(&answer)?;
        match answer {
            Some(answer) => {
                let answer = Zeroizing::new(answer);
                writeln!(std::io::stdout(), "{}", answer.as_str())?;
            }
            None => std::process::exit(1),
        }
        Ok(())
    })();
    if result.is_err() {
        std::process::exit(1);
    }
    true
}
