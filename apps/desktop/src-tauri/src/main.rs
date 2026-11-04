#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use sha2::{Digest, Sha256};
use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use std::{fs, io::Read, path::Path, sync::Mutex};
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

fn parse_json(bytes: &[u8], error_message: &str) -> Result<serde_json::Value, String> {
    serde_json::from_slice(bytes).map_err(|_| error_message.to_string())
}

/// Verifies the manifest against a digest compiled into the executable, then
/// verifies every declared payload byte during normal application startup.
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

    let manifest = parse_json(
        manifest_bytes,
        "Embedded curriculum manifest is not valid JSON.",
    )?;
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
    let max_app_version_is_null = manifest
        .get("maxAppVersion")
        .map(serde_json::Value::is_null)
        .unwrap_or(false);
    if manifest.get("minAppVersion").and_then(|value| value.as_str()) != Some("0.1.0")
        || !max_app_version_is_null
    {
        return Err("Embedded curriculum application compatibility range is not supported.".into());
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

    let lesson = parse_json(
        lesson_bytes,
        "Embedded curriculum lesson is not valid JSON.",
    )?;
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

fn read_bounded_resource(path: &Path, maximum_bytes: usize) -> Result<Vec<u8>, String> {
    let metadata = fs::symlink_metadata(path).map_err(|error| error.to_string())?;
    if !metadata.file_type().is_file() || metadata.len() == 0
        || metadata.len() > maximum_bytes as u64
    {
        return Err("Embedded curriculum resource is not a regular file within its size limit.".into());
    }

    let file = fs::File::open(path).map_err(|error| error.to_string())?;
    let mut bytes = Vec::with_capacity(metadata.len() as usize);
    file.take(maximum_bytes as u64 + 1)
        .read_to_end(&mut bytes)
        .map_err(|error| error.to_string())?;
    if bytes.len() > maximum_bytes || bytes.len() as u64 != metadata.len() {
        return Err("Embedded curriculum resource changed size while being read.".into());
    }
    Ok(bytes)
}

fn verify_embedded_curriculum(app: &tauri::AppHandle) -> Result<(), String> {
    let resource_root = app.path()
        .resolve("curriculum", BaseDirectory::Resource)
        .map_err(|error| error.to_string())?;
    let manifest_path = resource_root.join("manifest.json");
    let lesson_path = resource_root.join(EXPECTED_LESSON_PATH);

    let manifest_bytes = read_bounded_resource(&manifest_path, MAX_MANIFEST_BYTES)?;
    let lesson_bytes = read_bounded_resource(&lesson_path, MAX_LESSON_BYTES)?;
    verify_curriculum_payload(&manifest_bytes, &lesson_bytes)
}

#[derive(Debug)]
struct NativeDatabase(Mutex<Connection>);

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
struct LessonProgress {
    learner_id: String,
    lesson_id: String,
    completed_step_ids: Vec<String>,
    updated_at: String,
    content_version: String,
}

fn initialize_database(connection: &Connection) -> rusqlite::Result<()> {
    let version: i64 = connection.pragma_query_value(None, "user_version", |row| row.get(0))?;
    if version > 1 {
        return Err(rusqlite::Error::InvalidQuery);
    }
    if version == 0 {
        connection.execute_batch(
            "BEGIN IMMEDIATE;
             CREATE TABLE lesson_progress (
                 learner_id TEXT NOT NULL CHECK(length(trim(learner_id)) > 0),
                 lesson_id TEXT NOT NULL CHECK(length(trim(lesson_id)) > 0),
                 completed_step_ids_json TEXT NOT NULL CHECK(json_valid(completed_step_ids_json)),
                 updated_at TEXT NOT NULL,
                 content_version TEXT NOT NULL,
                 PRIMARY KEY (learner_id, lesson_id)
             );
             PRAGMA user_version = 1;
             COMMIT;",
        )?;
    }
    Ok(())
}

fn open_database(path: &Path) -> rusqlite::Result<Connection> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|_| rusqlite::Error::InvalidPath(path.to_path_buf()))?;
    }
    let connection = Connection::open(path)?;
    connection.busy_timeout(std::time::Duration::from_secs(5))?;
    connection.execute_batch("PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL;")?;
    initialize_database(&connection)?;
    Ok(connection)
}

fn validate_identifier(value: &str, field: &str, maximum_bytes: usize) -> rusqlite::Result<()> {
    if value.trim().is_empty()
        || value.len() > maximum_bytes
        || value.trim() != value
        || value.chars().any(char::is_control)
    {
        return Err(rusqlite::Error::InvalidParameterName(format!(
            "{field} must be non-empty, trimmed, free of control characters, and at most {maximum_bytes} bytes"
        )));
    }
    Ok(())
}

fn validate_learner_id(learner_id: &str) -> rusqlite::Result<()> {
    validate_identifier(learner_id, "learner_id", 128)
}

fn validate_lesson_id(lesson_id: &str) -> rusqlite::Result<()> {
    validate_identifier(lesson_id, "lesson_id", 160)
}

fn save_progress(connection: &Connection, progress: &LessonProgress) -> rusqlite::Result<()> {
    validate_learner_id(&progress.learner_id)?;
    validate_lesson_id(&progress.lesson_id)?;
    let completed = serde_json::to_string(&progress.completed_step_ids)
        .map_err(|_| rusqlite::Error::InvalidQuery)?;
    connection.execute(
        "INSERT INTO lesson_progress
            (learner_id, lesson_id, completed_step_ids_json, updated_at, content_version)
         VALUES (?1, ?2, ?3, ?4, ?5)
         ON CONFLICT(learner_id, lesson_id) DO UPDATE SET
            completed_step_ids_json = excluded.completed_step_ids_json,
            updated_at = excluded.updated_at,
            content_version = excluded.content_version",
        params![
            progress.learner_id,
            progress.lesson_id,
            completed,
            progress.updated_at,
            progress.content_version
        ],
    )?;
    Ok(())
}

fn read_progress(
    connection: &Connection,
    learner_id: &str,
    lesson_id: &str,
) -> rusqlite::Result<Option<LessonProgress>> {
    validate_learner_id(learner_id)?;
    validate_lesson_id(lesson_id)?;
    connection
        .query_row(
            "SELECT learner_id, lesson_id, completed_step_ids_json, updated_at, content_version
             FROM lesson_progress WHERE learner_id = ?1 AND lesson_id = ?2",
            params![learner_id, lesson_id],
            |row| {
                let completed_json: String = row.get(2)?;
                let completed_step_ids = serde_json::from_str(&completed_json)
                    .map_err(|_| rusqlite::Error::InvalidQuery)?;
                Ok(LessonProgress {
                    learner_id: row.get(0)?,
                    lesson_id: row.get(1)?,
                    completed_step_ids,
                    updated_at: row.get(3)?,
                    content_version: row.get(4)?,
                })
            },
        )
        .optional()
}

fn list_progress(connection: &Connection, learner_id: &str) -> rusqlite::Result<Vec<LessonProgress>> {
    validate_learner_id(learner_id)?;
    let mut statement = connection.prepare(
        "SELECT learner_id, lesson_id, completed_step_ids_json, updated_at, content_version
         FROM lesson_progress WHERE learner_id = ?1 ORDER BY lesson_id ASC",
    )?;
    let rows = statement.query_map(params![learner_id], |row| {
        let completed_json: String = row.get(2)?;
        let completed_step_ids = serde_json::from_str(&completed_json)
            .map_err(|_| rusqlite::Error::InvalidQuery)?;
        Ok(LessonProgress {
            learner_id: row.get(0)?,
            lesson_id: row.get(1)?,
            completed_step_ids,
            updated_at: row.get(3)?,
            content_version: row.get(4)?,
        })
    })?;
    rows.collect()
}

#[tauri::command]
fn save_lesson_progress(
    database: tauri::State<'_, NativeDatabase>,
    progress: LessonProgress,
) -> Result<(), String> {
    let connection = database.0.lock().map_err(|_| "Local database lock is unavailable.".to_string())?;
    save_progress(&connection, &progress).map_err(|error| error.to_string())
}

#[tauri::command]
fn read_lesson_progress(
    database: tauri::State<'_, NativeDatabase>,
    learner_id: String,
    lesson_id: String,
) -> Result<Option<LessonProgress>, String> {
    let connection = database.0.lock().map_err(|_| "Local database lock is unavailable.".to_string())?;
    read_progress(&connection, &learner_id, &lesson_id).map_err(|error| error.to_string())
}

#[tauri::command]
fn list_lesson_progress(
    database: tauri::State<'_, NativeDatabase>,
    learner_id: String,
) -> Result<Vec<LessonProgress>, String> {
    let connection = database.0.lock().map_err(|_| "Local database lock is unavailable.".to_string())?;
    list_progress(&connection, &learner_id).map_err(|error| error.to_string())
}

fn main() {
    tauri::Builder::default()
        .setup(|app| {
            if let Err(error) = verify_embedded_curriculum(app.handle()) {
                eprintln!("Fluently startup blocked: {error}");
                // The application must never continue after an integrity failure.
                std::process::exit(1);
            }

            let database_path = match app.path().app_data_dir() {
                Ok(directory) => directory.join("fluently.sqlite3"),
                Err(error) => {
                    eprintln!("Fluently local database path unavailable: {error}");
                    std::process::exit(1);
                }
            };
            let connection = match open_database(&database_path) {
                Ok(connection) => connection,
                Err(error) => {
                    eprintln!("Fluently local database initialization failed: {error}");
                    std::process::exit(1);
                }
            };
            app.manage(NativeDatabase(Mutex::new(connection)));
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            save_lesson_progress,
            read_lesson_progress,
            list_lesson_progress
        ])
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
    fn rejects_invalid_json_in_both_payload_types_and_oversized_input() {
        assert!(parse_json(b"{", "manifest invalid JSON")
            .unwrap_err()
            .contains("manifest invalid JSON"));
        assert!(parse_json(b"{", "lesson invalid JSON")
            .unwrap_err()
            .contains("lesson invalid JSON"));
        assert!(verify_curriculum_payload(MANIFEST, &vec![0; MAX_LESSON_BYTES + 1])
            .unwrap_err()
            .contains("invalid size"));
    }
}


#[cfg(test)]
mod sqlite_tests {
    use super::*;
    use std::sync::atomic::{AtomicU64, Ordering};

    static NEXT_DATABASE_ID: AtomicU64 = AtomicU64::new(0);

    fn temporary_database_path() -> std::path::PathBuf {
        std::env::temp_dir().join(format!(
            "fluently-h2b5-{}-{}.sqlite3",
            std::process::id(),
            NEXT_DATABASE_ID.fetch_add(1, Ordering::Relaxed)
        ))
    }

    fn sample_progress(learner_id: &str, completed: &[&str]) -> LessonProgress {
        LessonProgress {
            learner_id: learner_id.into(),
            lesson_id: "lesson-001".into(),
            completed_step_ids: completed.iter().map(|value| (*value).into()).collect(),
            updated_at: "2026-11-04T06:00:00Z".into(),
            content_version: "content-1".into(),
        }
    }

    #[test]
    fn creates_version_one_schema_and_rejects_future_schema_versions() {
        let connection = Connection::open_in_memory().unwrap();
        initialize_database(&connection).unwrap();
        let version: i64 = connection.pragma_query_value(None, "user_version", |row| row.get(0)).unwrap();
        assert_eq!(version, 1);
        connection.pragma_update(None, "user_version", 2).unwrap();
        assert!(initialize_database(&connection).is_err());
    }

    #[test]
    fn progress_is_isolated_by_learner_and_lesson() {
        let connection = Connection::open_in_memory().unwrap();
        initialize_database(&connection).unwrap();
        save_progress(&connection, &sample_progress("learner-a", &["step-1"])).unwrap();
        save_progress(&connection, &sample_progress("learner-b", &["step-2"])).unwrap();

        assert_eq!(
            read_progress(&connection, "learner-a", "lesson-001").unwrap().unwrap().completed_step_ids,
            vec!["step-1"]
        );
        assert_eq!(
            read_progress(&connection, "learner-b", "lesson-001").unwrap().unwrap().completed_step_ids,
            vec!["step-2"]
        );
        assert!(read_progress(&connection, "learner-a", "missing-lesson").unwrap().is_none());
    }

    #[test]
    fn saving_the_same_learner_lesson_updates_one_record() {
        let connection = Connection::open_in_memory().unwrap();
        initialize_database(&connection).unwrap();
        save_progress(&connection, &sample_progress("learner-a", &["step-1"])).unwrap();
        save_progress(&connection, &sample_progress("learner-a", &["step-1", "step-2"])).unwrap();

        let count: i64 = connection.query_row("SELECT COUNT(*) FROM lesson_progress", [], |row| row.get(0)).unwrap();
        assert_eq!(count, 1);
        assert_eq!(
            read_progress(&connection, "learner-a", "lesson-001").unwrap().unwrap().completed_step_ids,
            vec!["step-1", "step-2"]
        );
    }

    #[test]
    fn rejects_empty_or_malformed_learner_and_lesson_identifiers() {
        let connection = Connection::open_in_memory().unwrap();
        initialize_database(&connection).unwrap();

        assert!(save_progress(&connection, &sample_progress(" ", &[])).is_err());
        assert!(save_progress(&connection, &sample_progress(" learner-a", &[])).is_err());
        assert!(save_progress(&connection, &sample_progress("learner-a\\n", &[])).is_err());
        assert!(save_progress(&connection, &sample_progress(&"x".repeat(129), &[])).is_err());

        let mut invalid = sample_progress("learner-a", &[]);
        invalid.lesson_id = "".into();
        assert!(save_progress(&connection, &invalid).is_err());
        invalid.lesson_id = " lesson-001".into();
        assert!(save_progress(&connection, &invalid).is_err());
        invalid.lesson_id = "x".repeat(161);
        assert!(save_progress(&connection, &invalid).is_err());
    }

    #[test]
    fn lists_only_the_selected_learners_progress_in_stable_lesson_order() {
        let connection = Connection::open_in_memory().unwrap();
        initialize_database(&connection).unwrap();

        let mut learner_a_second = sample_progress("learner-a", &["step-2"]);
        learner_a_second.lesson_id = "lesson-002".into();
        let mut learner_a_first = sample_progress("learner-a", &["step-1"]);
        learner_a_first.lesson_id = "lesson-001".into();
        let learner_b = sample_progress("learner-b", &["private-step"]);

        save_progress(&connection, &learner_a_second).unwrap();
        save_progress(&connection, &learner_b).unwrap();
        save_progress(&connection, &learner_a_first).unwrap();

        let listed = list_progress(&connection, "learner-a").unwrap();
        assert_eq!(
            listed.iter().map(|item| item.lesson_id.as_str()).collect::<Vec<_>>(),
            vec!["lesson-001", "lesson-002"]
        );
        assert!(listed.iter().all(|item| item.learner_id == "learner-a"));
        assert_eq!(listed[0].completed_step_ids, vec!["step-1"]);
        assert_eq!(listed[1].completed_step_ids, vec!["step-2"]);
        assert!(list_progress(&connection, "learner-with-no-progress").unwrap().is_empty());
    }

    #[test]
    fn read_and_list_reject_invalid_identifiers() {
        let connection = Connection::open_in_memory().unwrap();
        initialize_database(&connection).unwrap();

        assert!(read_progress(&connection, " ", "lesson-001").is_err());
        assert!(read_progress(&connection, "learner-a", "lesson-001\\n").is_err());
        assert!(list_progress(&connection, &"x".repeat(129)).is_err());
    }

    #[test]
    fn progress_survives_closing_and_reopening_the_database() {
        let path = temporary_database_path();
        {
            let connection = open_database(&path).unwrap();
            save_progress(&connection, &sample_progress("learner-a", &["step-1", "step-3"])).unwrap();
        }
        {
            let connection = open_database(&path).unwrap();
            assert_eq!(
                read_progress(&connection, "learner-a", "lesson-001").unwrap().unwrap().completed_step_ids,
                vec!["step-1", "step-3"]
            );
        }
        let _ = fs::remove_file(&path);
        let _ = fs::remove_file(path.with_extension("sqlite3-wal"));
        let _ = fs::remove_file(path.with_extension("sqlite3-shm"));
    }
}
