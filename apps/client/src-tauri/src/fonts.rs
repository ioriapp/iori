// Runs off the main thread: enumerating many installed fonts can take a while.
#[tauri::command(async)]
pub fn native_font_families() -> Result<Vec<String>, String> {
    let families = font_kit::source::SystemSource::new()
        .all_families()
        .map_err(|error| error.to_string())?;
    Ok(normalize_families(families))
}

fn normalize_families(mut families: Vec<String>) -> Vec<String> {
    families.retain(|family| !family.trim().is_empty());
    families.sort_by_cached_key(|family| (family.to_lowercase(), family.clone()));
    families.dedup_by(|a, b| a.to_lowercase() == b.to_lowercase());
    families
}

#[cfg(test)]
mod tests {
    use super::normalize_families;

    #[test]
    fn families_are_sorted_and_deduplicated_without_case() {
        let families = [
            "zeta", "Alpha", "alpha", "", "  ", "Beta", "Éclair", "éclair",
        ]
        .into_iter()
        .map(str::to_owned)
        .collect();
        assert_eq!(
            normalize_families(families),
            ["Alpha", "Beta", "zeta", "Éclair"]
        );
    }
}
