//! Turning what the user typed into an FTS5 query.

/// Builds an FTS5 query from search text: every whitespace-separated word
/// becomes a quoted prefix term and the terms are ANDed. Quoting makes FTS5
/// syntax (`*`, `-`, `(`, `AND`, `NEAR`) plain text, and a `"` inside a word
/// is dropped since it could end the quoting early. `None` when no words
/// remain, meaning there is nothing to search for.
pub fn fts_query(input: &str) -> Option<String> {
    let terms: Vec<String> = input
        .split_whitespace()
        .map(|word| word.replace('"', ""))
        .filter(|word| !word.is_empty())
        .map(|word| format!("\"{word}\"*"))
        .collect();
    if terms.is_empty() {
        None
    } else {
        Some(terms.join(" "))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn each_word_becomes_a_quoted_prefix_term() {
        assert_eq!(fts_query("pars csv").as_deref(), Some("\"pars\"* \"csv\"*"));
    }

    #[test]
    fn quotes_are_removed() {
        assert_eq!(fts_query("a\"b").as_deref(), Some("\"ab\"*"));
        assert_eq!(fts_query("\"x y\"").as_deref(), Some("\"x\"* \"y\"*"));
        assert_eq!(fts_query("\""), None);
    }

    #[test]
    fn blank_input_is_none() {
        assert_eq!(fts_query(""), None);
        assert_eq!(fts_query(" \t\n "), None);
    }
}
