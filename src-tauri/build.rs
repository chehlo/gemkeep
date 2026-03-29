fn main() {
    tauri_build::build();

    // On macOS with gexiv2 0.16+, the symbol gexiv2_metadata_free was removed
    // (replaced by g_object_unref). Compile a C shim that provides it.
    #[cfg(target_os = "macos")]
    {
        let glib_flags = std::process::Command::new("pkg-config")
            .args(["--cflags", "glib-2.0"])
            .output()
            .expect("pkg-config not found");
        let cflags = String::from_utf8(glib_flags.stdout).unwrap();

        let mut build = cc::Build::new();
        build.file("compat/gexiv2_compat.c");
        for flag in cflags.split_whitespace() {
            build.flag(flag);
        }
        build.compile("gexiv2_compat");
    }
}
