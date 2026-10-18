use std::fs::Metadata;

// Windows junctions and other reparse points must not bypass the no-links rule.
// Unix keeps its existing symlink check; this does not follow the target.
pub fn is_link(metadata: &Metadata) -> bool {
    #[cfg(windows)]
    {
        use std::os::windows::fs::MetadataExt;
        const FILE_ATTRIBUTE_REPARSE_POINT: u32 = 0x400;
        if metadata.file_attributes() & FILE_ATTRIBUTE_REPARSE_POINT != 0 {
            return true;
        }
    }
    metadata.file_type().is_symlink()
}

#[cfg(all(test, windows))]
pub fn test_junction(target: &std::path::Path, link: &std::path::Path) {
    // Directory junctions do not require Developer Mode or symlink privileges.
    // Fixtures are local drive paths; mklink receives ordinary absolute names.
    let ordinary = |path: &std::path::Path| {
        path.to_str()
            .unwrap()
            .trim_start_matches(r"\\?\")
            .to_owned()
    };
    let output = std::process::Command::new("cmd")
        .args(["/D", "/C", "mklink", "/J"])
        .arg(ordinary(link))
        .arg(ordinary(target))
        .output()
        .unwrap();
    assert!(
        output.status.success(),
        "Could not create test junction: {output:?}"
    );
}
