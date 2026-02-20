/// Generate a URL-safe slug from a project name, guaranteed to be unique
/// among `existing` slugs.
pub fn generate_slug(name: &str, existing: &[String]) -> String {
    let base = slugify(name);
    make_unique(base, existing)
}

fn slugify(name: &str) -> String {
    // 1. Lowercase
    let lower = name.to_lowercase();

    // 2. Replace any run of non-[a-z0-9] chars with a single hyphen
    let mut slug = String::with_capacity(lower.len());
    let mut prev_was_hyphen = false;
    for ch in lower.chars() {
        if ch.is_ascii_alphanumeric() {
            slug.push(ch);
            prev_was_hyphen = false;
        } else if !prev_was_hyphen {
            slug.push('-');
            prev_was_hyphen = true;
        }
    }

    // 3. Trim leading/trailing hyphens
    let slug = slug.trim_matches('-').to_string();

    // 4. Truncate to 60 chars, re-trim trailing hyphens
    let slug = if slug.len() > 60 {
        let truncated = &slug[..60];
        truncated.trim_end_matches('-').to_string()
    } else {
        slug
    };

    // 5. If empty → "project"
    if slug.is_empty() {
        "project".to_string()
    } else {
        slug
    }
}

fn make_unique(base: String, existing: &[String]) -> String {
    // 6. If base slug is not in existing, return it
    if !existing.contains(&base) {
        return base;
    }

    // 7. Append -2, -3, ... until unique
    let mut counter: u32 = 2;
    loop {
        let candidate = format!("{}-{}", base, counter);
        if !existing.contains(&candidate) {
            return candidate;
        }
        counter += 1;
    }
}

/// Returns true iff the slug is non-empty, len <= 60, contains only
/// [a-z0-9-], and has no leading/trailing hyphen.
pub fn is_valid_slug(s: &str) -> bool {
    if s.is_empty() || s.len() > 60 {
        return false;
    }
    if s.starts_with('-') || s.ends_with('-') {
        return false;
    }
    s.chars()
        .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '-')
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_iceland_2024() {
        assert_eq!(generate_slug("Iceland 2024", &[]), "iceland-2024");
    }

    #[test]
    fn test_trim_hyphens() {
        assert_eq!(generate_slug("  --hello-- ", &[]), "hello");
    }

    #[test]
    fn test_special_chars() {
        assert_eq!(generate_slug("My Project!!!", &[]), "my-project");
    }

    #[test]
    fn test_empty_string() {
        assert_eq!(generate_slug("", &[]), "project");
    }

    #[test]
    fn test_all_hyphens() {
        assert_eq!(generate_slug("---", &[]), "project");
    }

    #[test]
    fn test_uniqueness_single_existing() {
        let existing = vec!["my-project".to_string()];
        assert_eq!(generate_slug("my project", &existing), "my-project-2");
    }

    #[test]
    fn test_uniqueness_two_existing() {
        let existing = vec!["my-project".to_string(), "my-project-2".to_string()];
        assert_eq!(generate_slug("my project", &existing), "my-project-3");
    }

    #[test]
    fn test_truncation() {
        // 70 chars of 'a' → slug must be <= 60
        let name = "a".repeat(70);
        let slug = generate_slug(&name, &[]);
        assert!(slug.len() <= 60, "slug too long: {}", slug.len());
    }

    #[test]
    fn test_truncation_no_trailing_hyphen() {
        // Name that produces a hyphen right at position 60 after truncation
        // "aaaaaaa... bbbbb" — space becomes hyphen; if hyphen falls at boundary, trim it
        let name = format!("{}x bbb", "a".repeat(59));
        let slug = generate_slug(&name, &[]);
        assert!(slug.len() <= 60);
        assert!(!slug.ends_with('-'));
    }

    #[test]
    fn test_is_valid_slug_valid() {
        assert!(is_valid_slug("iceland-2024"));
    }

    #[test]
    fn test_is_valid_slug_empty() {
        assert!(!is_valid_slug(""));
    }

    #[test]
    fn test_is_valid_slug_uppercase() {
        assert!(!is_valid_slug("A-B"));
    }

    #[test]
    fn test_is_valid_slug_leading_hyphen() {
        assert!(!is_valid_slug("-abc"));
    }

    #[test]
    fn test_is_valid_slug_trailing_hyphen() {
        assert!(!is_valid_slug("abc-"));
    }

    #[test]
    fn test_is_valid_slug_too_long() {
        let s = "a".repeat(61);
        assert!(!is_valid_slug(&s));
    }

    #[test]
    fn test_is_valid_slug_exactly_60() {
        let s = "a".repeat(60);
        assert!(is_valid_slug(&s));
    }
}
