/// Asset protocol scope tests.
///
/// These tests reproduce the exact bug seen at runtime:
///   ERROR tauri::protocol::asset: asset protocol not configured to allow the path
///
/// ROOT CAUSE (found by reading tauri-2.10.2/src/scope/fs.rs):
///   Tauri sets `require_literal_leading_dot: true` on Unix.
///   This means `**` does NOT match path components starting with `.` (hidden dirs).
///   The app stores data in `~/.gem-keep/` — a hidden directory.
///   Any scope using `**` to reach it fails SILENTLY.
///
/// PATTERNS THAT FAIL:
///   ["/**"]        — `**` skips `.gem-keep`
///   ["$HOME/**"]   — expanded to `/home/user/**`, same problem
///
/// CORRECT PATTERN:
///   ["$HOME/.gem-keep/**"] — `.gem-keep` is literal, then `**` for contents
///
/// These tests FAIL with scope `/**` and PASS with `$HOME/.gem-keep/**`
/// (after HOME expansion).  They are the test that should have existed before
/// any scope change was made.

#[cfg(test)]
mod tests {
    use glob::{MatchOptions, Pattern};

    /// Tauri's exact MatchOptions (from tauri-2.x/src/scope/fs.rs), platform-aware.
    /// Reproduces the precise scope-checking behavior at runtime.
    fn tauri_match_options() -> MatchOptions {
        MatchOptions {
            // Prevents `dir/*` from matching `dir/subdir/file` (security)
            require_literal_separator: true,
            // THE KEY FLAG on Unix: `**` does NOT match components starting with `.`
            // This is what makes `/**` fail for `~/.gem-keep/...`
            #[cfg(unix)]
            require_literal_leading_dot: true,
            #[cfg(windows)]
            require_literal_leading_dot: false,
            case_sensitive: cfg!(unix),
        }
    }

    /// Read the actual scope patterns from tauri.conf.json and expand $HOME.
    fn actual_scope_patterns() -> Vec<String> {
        let conf_path = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("tauri.conf.json");
        let conf: serde_json::Value = serde_json::from_str(
            &std::fs::read_to_string(&conf_path)
                .unwrap_or_else(|_| panic!("cannot read {}", conf_path.display())),
        )
        .expect("tauri.conf.json must be valid JSON");
        conf["app"]["security"]["assetProtocol"]["scope"]
            .as_array()
            .expect("scope must be array")
            .iter()
            .map(|v| {
                let p = v.as_str().unwrap_or("").to_string();
                if let Some(home) = dirs::home_dir() {
                    p.replace("$HOME", &home.to_string_lossy())
                } else {
                    p
                }
            })
            .collect()
    }

    /// A representative thumbnail cache path built from the actual gemkeep_home().
    fn actual_thumbnail_cache_path() -> std::path::PathBuf {
        crate::projects::manager::gemkeep_home()
            .join("projects")
            .join("any-project")
            .join("cache")
            .join("thumbnails")
            .join("1.jpg")
    }

    #[test]
    fn scope_slash_star_star_does_not_match_dot_gem_keep() {
        // RED TEST — documents the ORIGINAL bug.
        // This reproduces exactly why the user saw:
        //   ERROR asset protocol not configured to allow the path: ~/.gem-keep/...
        //
        // The scope ["/**"] was set thinking it allows all absolute paths.
        // It does NOT — Tauri's glob silently skips hidden directories on Unix.
        let opts = tauri_match_options();
        let thumb_path = actual_thumbnail_cache_path();
        let thumb_str = thumb_path.to_string_lossy();
        let bad = Pattern::new("/**").unwrap();
        assert!(
            !bad.matches_with(&thumb_str, opts),
            "/**  MUST NOT match .gem-keep paths — this confirms the bug that caused the runtime error"
        );
    }

    #[test]
    fn scope_home_star_star_does_not_match_dot_gem_keep() {
        // Also documents that $HOME/** (after expansion to /home/user/**) has the same bug.
        let opts = tauri_match_options();
        let home = dirs::home_dir().expect("home dir must exist");
        let home_glob = format!("{}/**", home.display());
        let expanded = Pattern::new(&home_glob).unwrap();
        let thumb_path = actual_thumbnail_cache_path();
        let thumb_str = thumb_path.to_string_lossy();
        assert!(
            !expanded.matches_with(&thumb_str, opts),
            "/home/user/** MUST NOT match .gem-keep paths — $HOME/** has the same bug"
        );
    }

    #[test]
    fn scope_home_dot_gem_keep_star_star_matches_thumbnails() {
        // GREEN TEST — the correct pattern.
        // "$HOME/.gem-keep/**" after HOME expansion
        // — .gem-keep is a LITERAL component, not matched by a wildcard.
        // — ** after the literal matches all nested files.
        let opts = tauri_match_options();
        let home = dirs::home_dir().expect("home dir must exist");
        let correct_glob = format!("{}/.gem-keep/**", home.display());
        let correct = Pattern::new(&correct_glob).unwrap();
        let thumb_path = actual_thumbnail_cache_path();
        let thumb_str = thumb_path.to_string_lossy();
        assert!(
            correct.matches_with(&thumb_str, opts),
            "/home/user/.gem-keep/** must match thumbnail cache paths"
        );
    }

    #[test]
    fn scope_home_dot_gem_keep_matches_deep_nested_path() {
        let opts = tauri_match_options();
        let home = dirs::home_dir().expect("home dir must exist");
        let home_str = home.to_string_lossy();
        let pattern_str = format!("{}/.gem-keep/**", home_str);
        let pattern = Pattern::new(&pattern_str).unwrap();
        let paths = [
            format!(
                "{}/.gem-keep/projects/iceland/cache/thumbnails/1.jpg",
                home_str
            ),
            format!(
                "{}/.gem-keep/projects/wedding/cache/thumbnails/42.jpg",
                home_str
            ),
            format!("{}/.gem-keep/config.json", home_str),
        ];
        for p in &paths {
            assert!(pattern.matches_with(p, opts), "must match: {}", p);
        }
    }

    #[test]
    fn scope_does_not_escape_gem_keep_dir() {
        // Sanity check: the scope should NOT allow paths outside .gem-keep
        let opts = tauri_match_options();
        let home = dirs::home_dir().expect("home dir must exist");
        let pattern_str = format!("{}/.gem-keep/**", home.display());
        let pattern = Pattern::new(&pattern_str).unwrap();
        let outside = format!("{}/Documents/private.txt", home.display());
        assert!(
            !pattern.matches_with(&outside, opts),
            "scope must not allow paths outside .gem-keep: {}",
            outside
        );
    }

    #[test]
    fn actual_scope_config_allows_thumbnail_cache_path() {
        // THE CRITICAL END-TO-END TEST:
        // Reads the ACTUAL scope from tauri.conf.json (compiled into binary)
        // Expands $HOME dynamically (same as Tauri runtime)
        // Uses ACTUAL gemkeep_home() cache path (same as list_stacks command)
        // Uses Tauri's EXACT MatchOptions (same as runtime scope checking)
        //
        // If this test fails → thumbnails WILL fail to load in the real app.
        // This is the test that would have caught the $HOME/** bug.
        let opts = tauri_match_options();
        let thumb_path = actual_thumbnail_cache_path();
        let thumb_str = thumb_path.to_string_lossy();
        let patterns = actual_scope_patterns();
        let allowed = patterns.iter().any(|p| {
            glob::Pattern::new(p)
                .map(|pat| pat.matches_with(&thumb_str, opts))
                .unwrap_or(false)
        });
        assert!(
            allowed,
            "scope {:?} must allow actual thumbnail cache path: {}",
            patterns, thumb_str
        );
    }
}
