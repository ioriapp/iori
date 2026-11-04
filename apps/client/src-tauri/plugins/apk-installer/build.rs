fn main() {
    tauri_plugin::Builder::new(&[
        "can_request_package_installs",
        "open_install_permission_settings",
        "install_apk",
    ])
    .android_path("android")
    .build();
}
