#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use sha2::{Digest, Sha256};
use std::{error::Error, fs, io, path::PathBuf};
use tauri::{path::BaseDirectory, Manager};

const TRUSTED_MANIFEST_SHA256: &str =
    "957fa749b834a8be4ee3f516e0ab2ff977bb7c37ea802b97464b53678b9e7892";
const EXPECTED_PACKAGE_ID: &str = "fluently-h2b4-integrity-fixture";
const EXPECTED_CONTENT_VERSION: &str = "0.0.0-h2b4-test";
const EXPECTED_LESSON_PATH: &str = "lessons/pre-a1-integrity-fixture.json";
const MAX_MANIFEST_BYTES: usize = 64 * 1024;
const MAX_LESSON_BYTES: usize = 1024 * 1024;

fn sha256_hex(bytes: &[u8]) -> String {
    let digest = Sha256::digest(bytes);
    digest.iter().map(|byte| format!("{byte:02x}")).collect()
}

/// Verifies the manifest against a digest compiled into the executable, then
/// verifies every declared payload byte before the application can start.
fn verify_curriculum_payload(manifest_bytes: &[u8], lesson_bytes: &[u8]) -> Result<(), String> {
    if manifest_bytes.is_empty() || manifest_bytes.len() > MAX_MANIFEST_BYTES {
        return Err("Embedded curriculum manifest has an invalid size.".into());
    }
    if lesson_bytes.is_empty() || lesson_bytes.len() > MAX_LESSON_BYTES {
        return Err("Embedded curriculum lesson has an invalid size.".into());
    }
    if sha256_hex(manifest_bytes) != TRUSTED_MANIFEST_SHA256 {
        return Err("Embedded curriculum manifest integrity check failed.".into());
    }

    let manifest: serde_json::Value = serde_json::from_slice(manifest_bytes)
        .map_err(|_| "Embedded curriculum manifest is not valid JSON.")?;
    if manifest.get("packageId").and_then(|value| value.as_str()) != Some(EXPECTED_PACKAGE_ID) {
        return Err("Embedded curriculum package identifier is not supported.".into());
    }
    if manifest.get("contentVersion").and_then(|value| value.as_str())
        != Some(EXPECTED_CONTENT_VERSION)
    {
        return Err("Embedded curriculum content version is not supported.".into());
    }
    if manifest.get("schemaVersion").and_then(|value| value.as_u64()) != Some(1) {
        return Err("Embedded curriculum schema version is not supported.".into());
    }

    let files = manifest.get("files").and_then(|value| value.as_array())
        .ok_or("Embedded curriculum manifest has no file list.")?;
    if files.len() != 1 {
        return Err("Embedded curriculum fixture must contain exactly one declared file.".into());
    }

    let entry = &files[0];
    if entry.get("path").and_then(|value| value.as_str()) != Some(EXPECTED_LESSON_PATH) {
        return Err("Embedded curriculum contains an unexpected file path.".into());
    }
    if entry.get("bytes").and_then(|value| value.as_u64()) != Some(lesson_bytes.len() as u64) {
        return Err("Embedded curriculum lesson size does not match its manifest.".into());
    }
    let expected_digest = entry.get("sha256").and_then(|value| value.as_str())
        .ok_or("Embedded curriculum lesson digest is missing.")?;
    if sha256_hex(lesson_bytes) != expected_digest {
        return Err("Embedded curriculum lesson SHA-256 check failed.".into());
    }

    let lesson: serde_json::Value = serde_json::from_slice(lesson_bytes)
        .map_err(|_| "Embedded curriculum lesson is not valid JSON.")?;
    if lesson.get("id").and_then(|value| value.as_str()) != Some("h2b4-integrity-fixture")
        || lesson.get("type").and_then(|value| value.as_str()) != Some("lesson")
        || lesson.get("status").and_then(|value| value.as_str()) != Some("draft")
        || lesson.get("contentVersion").and_then(|value| value.as_str())
            != Some(EXPECTED_CONTENT_VERSION)
    {
        return Err("Embedded curriculum fixture metadata is invalid.".into());
    }

    Ok(())
}

fn verify_embedded_curriculum(app: &tauri::AppHandle) -> Result<(), Box<dyn Error>> {
    let resource_root: PathBuf = app.path().resolve("curriculum", BaseDirectory::Resource)?;
    let manifest_path = resource_root.join("manifest.json");
    let lesson_path = resource_root.join(EXPECTED_LESSON_PATH);

    let manifest_bytes = fs::read(&manifest_path)?;
    let lesson_bytes = fs::read(&lesson_path)?;
    verify_curriculum_payload(&manifest_bytes, &lesson_bytes).map_err(io::Error::other)?;
    Ok(())
}

fn main() {
    tauri::Builder::default()
        .setup(|app| {
            verify_embedded_curriculum(app.handle()).map_err(io::Error::other)?;
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("failed to run Fluently desktop application");
}

#[cfg(test)]
mod tests {
    use super::*;

    const MANIFEST: &[u8] = include_bytes!("../resources/curriculum/manifest.json");
    const LESSON: &[u8] =
        include_bytes!("../resources/curriculum/lessons/pre-a1-integrity-fixture.json");

    #[test]
    fn accepts_the_exact_embedded_fixture() {
        assert!(verify_curriculum_payload(MANIFEST, LESSON).is_ok());
    }

    #[test]
    fn rejects_a_changed_manifest_before_reading_content() {
        let mut changed = MANIFEST.to_vec();
        changed[10] ^= 1;
        let result = verify_curriculum_payload(&changed, LESSON);
        assert!(result.unwrap_err().contains("manifest integrity"));
    }

    #[test]
    fn rejects_a_single_changed_lesson_byte() {
        let mut changed = LESSON.to_vec();
        changed[20] ^= 1;
        let result = verify_curriculum_payload(MANIFEST, &changed);
        assert!(result.unwrap_err().contains("SHA-256"));
    }

    #[test]
    fn rejects_invalid_json_and_oversized_input() {
        assert!(verify_curriculum_payload(b"{", LESSON).is_err());
        assert!(verify_curriculum_payload(MANIFEST, &vec![0; MAX_LESSON_BYTES + 1]).is_err());
    }
}
