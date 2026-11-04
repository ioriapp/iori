# Third-party licenses

The iori license is in [LICENSE](LICENSE). Third-party license texts and their sources are stored under [scripts/licenses/sources](scripts/licenses/sources/). The Cargo and Android indexes identify the component, version, source and stored text for each dependency. The [clarifications](scripts/licenses/sources/clarifications/) record cases where the upstream distribution and repository did not include a license text.

The Host build places the Node.js license and generated npm and Rust notices in the Host archive. The Client frontend build generates `THIRD-PARTY-LICENSES.txt` in the bundled frontend assets. The Android build also places `THIRD-PARTY-ANDROID.txt` in the APK assets. See [DEVELOPMENT.md](DEVELOPMENT.md) for the commands used to refresh the stored sources when dependencies change.

The Linux AppImage includes `THIRD-PARTY-LINUX-LIBRARIES.txt` at its root, with the bundled Ubuntu libraries and AppImage runtime notices.
