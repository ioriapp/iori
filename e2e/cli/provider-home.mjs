import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

// Each provider points only at this test's fake API, using a fixture credential.
export async function providerHome(cli, home, baseURL) {
  const files = {
    vtcode: [
      ".vtcode/vtcode.toml",
      `[agent]
provider = "verification"
api_key_env = "IORI_FAKE_MODEL_KEY"
default_model = "gpt-6-luna"
[[custom_providers]]
name = "verification"
display_name = "Verification"
base_url = "${baseURL}/v1"
api_key_env = "IORI_FAKE_MODEL_KEY"
model = "gpt-6-luna"
context_window = 128000
api_format = "openai-responses"
`,
    ],
    hermes: [
      ".hermes/config.yaml",
      `model:
  default: gpt-6-luna
  provider: custom:verification
  base_url: ${baseURL}/v1
  api_key: verification
  api_mode: codex_responses
custom_providers:
  - name: verification
    base_url: ${baseURL}/v1
    api_key: verification
    api_mode: codex_responses
    model: gpt-6-luna
hooks_auto_accept: true
auth:
  import_from_cli: false
`,
    ],
    vibe: [
      ".vibe/config.toml",
      `active_model = "gpt-6-luna"
[[providers]]
name = "verification"
api_base = "${baseURL}/v1"
api_key_env_var = "IORI_FAKE_MODEL_KEY"
api_style = "openai-responses"
[[models]]
name = "gpt-6-luna"
provider = "verification"
alias = "gpt-6-luna"
`,
    ],
  };
  const entry = files[cli];
  if (!entry) return {};
  const [relative, text] = entry;
  const file = join(home, relative);
  await mkdir(join(file, ".."), { recursive: true });
  const hooks = await readFile(file, "utf8").catch((error) => {
    if (error.code !== "ENOENT") throw error;
    return "";
  });
  await writeFile(file, text + hooks, { mode: 0o600 });
  return {
    IORI_FAKE_MODEL_KEY: "verification",
  };
}
