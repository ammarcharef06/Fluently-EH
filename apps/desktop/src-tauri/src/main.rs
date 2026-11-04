#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use sha2::{Digest, Sha256};
use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use std::{fs, io::Read, path::Path, sync::Mutex};
use tauri::{path::BaseDirectory, Manager};
use uuid::{Uuid, Version};

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

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct LessonProgressInput {
    lesson_id: String,
    completed_step_ids: Vec<String>,
    updated_at: String,
    content_version: String,
}

const CURRENT_DATABASE_VERSION: i64 = 2;

fn initialize_database(connection: &Connection) -> rusqlite::Result<()> {
    // Serialize schema inspection and migration so two first-run processes cannot
    // both observe the same old user_version and race to create the same tables.
    connection.execute_batch("BEGIN IMMEDIATE;")?;
    let migration_result = (|| {
        let mut version: i64 =
            connection.pragma_query_value(None, "user_version", |row| row.get(0))?;
        if version > CURRENT_DATABASE_VERSION {
            return Err(rusqlite::Error::InvalidQuery);
        }

        if version == 0 {
            connection.execute_batch(
                "CREATE TABLE lesson_progress (
                     learner_id TEXT NOT NULL CHECK(length(trim(learner_id)) > 0),
                     lesson_id TEXT NOT NULL CHECK(length(trim(lesson_id)) > 0),
                     completed_step_ids_json TEXT NOT NULL CHECK(json_valid(completed_step_ids_json)),
                     updated_at TEXT NOT NULL,
                     content_version TEXT NOT NULL,
                     PRIMARY KEY (learner_id, lesson_id)
                 );
                 PRAGMA user_version = 1;",
            )?;
            version = 1;
        }

        if version == 1 {
            connection.execute_batch(
                "CREATE TABLE local_identity (
                     singleton_id INTEGER PRIMARY KEY CHECK(singleton_id = 1),
                     learner_id TEXT NOT NULL UNIQUE CHECK(length(learner_id) = 36),
                     indexeddb_progress_imported INTEGER NOT NULL DEFAULT 0
                         CHECK(indexeddb_progress_imported IN (0, 1))
                 );
                 PRAGMA user_version = 2;",
            )?;
        }

        Ok(())
    })();

    match migration_result {
        Ok(()) => connection.execute_batch("COMMIT;"),
        Err(error) => {
            let _ = connection.execute_batch("ROLLBACK;");
            Err(error)
        }
    }
}

fn open_database(path: &Path) -> rusqlite::Result<Connection> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)
            .map_err(|_| rusqlite::Error::InvalidPath(path.to_path_buf()))?;
    }
    let connection = Connection::open(path)?;
    connection.busy_timeout(std::time::Duration::from_secs(5))?;
    connection.execute_batch("PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL;")?;
    initialize_database(&connection)?;
    get_or_create_local_learner_id(&connection)?;
    Ok(connection)
}

fn validate_identifier(
    value: &str,
    field: &str,
    maximum_bytes: usize,
) -> rusqlite::Result<()> {
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
    let parsed = Uuid::parse_str(learner_id).map_err(|_| {
        rusqlite::Error::InvalidParameterName(
            "learner_id must be a UUID version 4 generated by the native runtime".into(),
        )
    })?;
    if parsed.get_version() != Some(Version::Random) {
        return Err(rusqlite::Error::InvalidParameterName(
            "learner_id must be a UUID version 4 generated by the native runtime".into(),
        ));
    }
    Ok(())
}

fn validate_lesson_id(lesson_id: &str) -> rusqlite::Result<()> {
    validate_identifier(lesson_id, "lesson_id", 160)
}

const MAX_COMPLETED_STEPS_PER_LESSON: usize = 2_000;
const MAX_PROGRESS_RECORD_BYTES: usize = 256 * 1024;
const MAX_LEGACY_PROGRESS_BYTES: usize = 16 * 1024 * 1024;

fn validate_progress_input(progress: &LessonProgressInput) -> rusqlite::Result<usize> {
    validate_lesson_id(&progress.lesson_id)?;
    validate_identifier(&progress.updated_at, "updated_at", 64)?;
    validate_identifier(&progress.content_version, "content_version", 128)?;

    if progress.completed_step_ids.len() > MAX_COMPLETED_STEPS_PER_LESSON {
        return Err(rusqlite::Error::InvalidParameterName(
            "completed_step_ids exceeds the allowed number of steps.".into(),
        ));
    }
    for step_id in &progress.completed_step_ids {
        validate_identifier(step_id, "completed_step_id", 160)?;
    }

    let serialized = serde_json::to_vec(progress).map_err(|_| rusqlite::Error::InvalidQuery)?;
    if serialized.len() > MAX_PROGRESS_RECORD_BYTES {
        return Err(rusqlite::Error::InvalidParameterName(
            "Lesson progress record exceeds the allowed size.".into(),
        ));
    }
    Ok(serialized.len())
}

fn get_or_create_local_learner_id(connection: &Connection) -> rusqlite::Result<String> {
    let existing: Option<String> = connection
        .query_row(
            "SELECT learner_id FROM local_identity WHERE singleton_id = 1",
            [],
            |row| row.get(0),
        )
        .optional()?;

    if let Some(learner_id) = existing {
        validate_learner_id(&learner_id)?;
        return Ok(learner_id);
    }

    // UUID v4 generation uses the operating system's cryptographically secure RNG.
    // The singleton constraint and INSERT conflict handling make first-run creation
    // safe when two application processes initialize the same database concurrently.
    let candidate = Uuid::new_v4().to_string();
    connection.execute(
        "INSERT INTO local_identity (singleton_id, learner_id)
         VALUES (1, ?1)
         ON CONFLICT(singleton_id) DO NOTHING",
        params![candidate],
    )?;

    let learner_id: String = connection.query_row(
        "SELECT learner_id FROM local_identity WHERE singleton_id = 1",
        [],
        |row| row.get(0),
    )?;
    validate_learner_id(&learner_id)?;
    Ok(learner_id)
}

fn save_progress(
    connection: &Connection,
    learner_id: &str,
    progress: &LessonProgressInput,
) -> rusqlite::Result<()> {
    validate_learner_id(learner_id)?;
    validate_progress_input(progress)?;
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
            learner_id,
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

fn list_progress(
    connection: &Connection,
    learner_id: &str,
) -> rusqlite::Result<Vec<LessonProgress>> {
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

const MAX_LEGACY_PROGRESS_RECORDS: usize = 10_000;

fn import_legacy_progress(
    connection: &mut Connection,
    progress: &[LessonProgressInput],
) -> rusqlite::Result<bool> {
    if progress.len() > MAX_LEGACY_PROGRESS_RECORDS {
        return Err(rusqlite::Error::InvalidParameterName(
            "Too many legacy lesson progress records to import at once.".into(),
        ));
    }

    let mut total_bytes = 0usize;
    for record in progress {
        let record_bytes = validate_progress_input(record)?;
        total_bytes = total_bytes
            .checked_add(record_bytes)
            .ok_or(rusqlite::Error::InvalidQuery)?;
        if total_bytes > MAX_LEGACY_PROGRESS_BYTES {
            return Err(rusqlite::Error::InvalidParameterName(
                "Legacy lesson progress batch exceeds the allowed size.".into(),
            ));
        }
    }

    let learner_id = get_or_create_local_learner_id(connection)?;
    let transaction = connection.transaction()?;
    let already_imported: i64 = transaction.query_row(
        "SELECT indexeddb_progress_imported FROM local_identity WHERE singleton_id = 1",
        [],
        |row| row.get(0),
    )?;

    if already_imported == 1 {
        transaction.commit()?;
        return Ok(false);
    }

    for record in progress {
        save_progress(&transaction, &learner_id, record)?;
    }

    transaction.execute(
        "UPDATE local_identity
         SET indexeddb_progress_imported = 1
         WHERE singleton_id = 1",
        [],
    )?;
    transaction.commit()?;
    Ok(true)
}

#[tauri::command]
fn import_legacy_lesson_progress(
    database: tauri::State<'_, NativeDatabase>,
    progress: Vec<LessonProgressInput>,
) -> Result<bool, String> {
    let mut connection = database
        .0
        .lock()
        .map_err(|_| "Local database lock is unavailable.".to_string())?;
    import_legacy_progress(&mut connection, &progress).map_err(|error| error.to_string())
}

fn clear_local_progress(connection: &mut Connection) -> rusqlite::Result<()> {
    let learner_id = get_or_create_local_learner_id(connection)?;
    let transaction = connection.transaction()?;
    transaction.execute(
        "DELETE FROM lesson_progress WHERE learner_id = ?1",
        params![learner_id],
    )?;
    transaction.execute(
        "DELETE FROM local_identity WHERE singleton_id = 1",
        [],
    )?;
    transaction.commit()
}

#[tauri::command]
fn clear_local_learning_data(
    database: tauri::State<'_, NativeDatabase>,
) -> Result<(), String> {
    let mut connection = database
        .0
        .lock()
        .map_err(|_| "Local database lock is unavailable.".to_string())?;
    clear_local_progress(&mut connection).map_err(|error| error.to_string())
}

#[tauri::command]
fn save_lesson_progress(
    database: tauri::State<'_, NativeDatabase>,
    progress: LessonProgressInput,
) -> Result<(), String> {
    let connection = database
        .0
        .lock()
        .map_err(|_| "Local database lock is unavailable.".to_string())?;
    let learner_id =
        get_or_create_local_learner_id(&connection).map_err(|error| error.to_string())?;
    save_progress(&connection, &learner_id, &progress).map_err(|error| error.to_string())
}

#[tauri::command]
fn read_lesson_progress(
    database: tauri::State<'_, NativeDatabase>,
    lesson_id: String,
) -> Result<Option<LessonProgress>, String> {
    let connection = database
        .0
        .lock()
        .map_err(|_| "Local database lock is unavailable.".to_string())?;
    let learner_id =
        get_or_create_local_learner_id(&connection).map_err(|error| error.to_string())?;
    read_progress(&connection, &learner_id, &lesson_id).map_err(|error| error.to_string())
}

#[tauri::command]
fn list_lesson_progress(
    database: tauri::State<'_, NativeDatabase>,
) -> Result<Vec<LessonProgress>, String> {
    let connection = database
        .0
        .lock()
        .map_err(|_| "Local database lock is unavailable.".to_string())?;
    let learner_id =
        get_or_create_local_learner_id(&connection).map_err(|error| error.to_string())?;
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
            import_legacy_lesson_progress,
            clear_local_learning_data,
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
    const LEARNER_A: &str = "00000000-0000-4000-8000-000000000001";
    const LEARNER_B: &str = "00000000-0000-4000-8000-000000000002";

    fn temporary_database_path() -> std::path::PathBuf {
        std::env::temp_dir().join(format!(
            "fluently-h2b6b-{}-{}.sqlite3",
            std::process::id(),
            NEXT_DATABASE_ID.fetch_add(1, Ordering::Relaxed)
        ))
    }

    fn sample_progress(completed: &[&str]) -> LessonProgressInput {
        LessonProgressInput {
            lesson_id: "lesson-001".into(),
            completed_step_ids: completed.iter().map(|value| (*value).into()).collect(),
            updated_at: "2026-11-04T06:00:00Z".into(),
            content_version: "content-1".into(),
        }
    }

    #[test]
    fn creates_version_two_schema_and_rejects_future_schema_versions() {
        let connection = Connection::open_in_memory().unwrap();
        initialize_database(&connection).unwrap();
        let version: i64 = connection
            .pragma_query_value(None, "user_version", |row| row.get(0))
            .unwrap();
        assert_eq!(version, CURRENT_DATABASE_VERSION);

        let identity_table_exists: i64 = connection
            .query_row(
                "SELECT COUNT(*) FROM sqlite_master WHERE type = 'table' AND name = 'local_identity'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(identity_table_exists, 1);

        connection.pragma_update(None, "user_version", 3).unwrap();
        assert!(initialize_database(&connection).is_err());
    }

    #[test]
    fn legacy_indexeddb_progress_is_imported_once_under_the_native_identity() {
        let mut connection = Connection::open_in_memory().unwrap();
        initialize_database(&connection).unwrap();
        let learner_id = get_or_create_local_learner_id(&connection).unwrap();

        let legacy = vec![sample_progress(&["step-1", "step-2"])];
        assert!(import_legacy_progress(&mut connection, &legacy).unwrap());

        let restored = read_progress(&connection, &learner_id, "lesson-001")
            .unwrap()
            .unwrap();
        assert_eq!(restored.learner_id, learner_id);
        assert_eq!(restored.completed_step_ids, vec!["step-1", "step-2"]);

        let later_data = vec![sample_progress(&["later-step"])];
        assert!(!import_legacy_progress(&mut connection, &later_data).unwrap());
        let still_restored = read_progress(&connection, &learner_id, "lesson-001")
            .unwrap()
            .unwrap();
        assert_eq!(still_restored.completed_step_ids, vec!["step-1", "step-2"]);
    }

    #[test]
    fn clearing_local_learning_data_removes_progress_and_rotates_the_local_identity() {
        let mut connection = Connection::open_in_memory().unwrap();
        initialize_database(&connection).unwrap();
        let learner_id = get_or_create_local_learner_id(&connection).unwrap();
        save_progress(&connection, &learner_id, &sample_progress(&["step-1"])).unwrap();

        clear_local_progress(&mut connection).unwrap();

        assert!(list_progress(&connection, &learner_id).unwrap().is_empty());
        let next_identity = get_or_create_local_learner_id(&connection).unwrap();
        assert_ne!(next_identity, learner_id);
    }

    #[test]
    fn failed_legacy_import_does_not_mark_the_migration_complete() {
        let mut connection = Connection::open_in_memory().unwrap();
        initialize_database(&connection).unwrap();
        let invalid = vec![sample_progress(&[])];
        let mut invalid_record = invalid[0].clone();
        invalid_record.lesson_id = " ".into();

        assert!(import_legacy_progress(&mut connection, &[invalid_record]).is_err());

        let imported: i64 = connection
            .query_row(
                "SELECT indexeddb_progress_imported FROM local_identity WHERE singleton_id = 1",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(imported, 0);
    }

    #[test]
    fn progress_inputs_are_bounded_and_reject_invalid_step_identifiers() {
        let mut progress = sample_progress(&["step-1"]);
        assert!(validate_progress_input(&progress).is_ok());

        progress.completed_step_ids = vec!["step".into(); MAX_COMPLETED_STEPS_PER_LESSON + 1];
        assert!(validate_progress_input(&progress).is_err());

        progress.completed_step_ids = vec!["".into()];
        assert!(validate_progress_input(&progress).is_err());

        progress.completed_step_ids = vec!["step-1".into()];
        progress.updated_at = "x".repeat(65);
        assert!(validate_progress_input(&progress).is_err());
    }

    #[test]
    fn legacy_import_rejects_a_batch_that_exceeds_the_byte_limit() {
        let mut connection = Connection::open_in_memory().unwrap();
        initialize_database(&connection).unwrap();
        let oversized = vec![
            LessonProgressInput {
                lesson_id: "lesson-001".into(),
                completed_step_ids: vec!["s".repeat(160); 1_000],
                updated_at: "2026-11-04T06:00:00Z".into(),
                content_version: "content-1".into(),
            };
            110
        ];
        assert!(import_legacy_progress(&mut connection, &oversized).is_err());
    }

    #[test]
    fn legacy_import_rejects_an_oversized_record_batch() {
        let mut connection = Connection::open_in_memory().unwrap();
        initialize_database(&connection).unwrap();
        let oversized = vec![sample_progress(&[]); MAX_LEGACY_PROGRESS_RECORDS + 1];
        assert!(import_legacy_progress(&mut connection, &oversized).is_err());
    }

    #[test]
    fn native_progress_input_rejects_a_webview_supplied_learner_id() {
        let payload = serde_json::json!({
            "learnerId": "00000000-0000-4000-8000-000000000001",
            "lessonId": "lesson-001",
            "completedStepIds": ["step-1"],
            "updatedAt": "2026-11-04T06:00:00Z",
            "contentVersion": "content-1"
        });
        assert!(serde_json::from_value::<LessonProgressInput>(payload).is_err());
    }

    #[test]
    fn creates_a_stable_uuid_v4_local_identity() {
        let connection = Connection::open_in_memory().unwrap();
        initialize_database(&connection).unwrap();

        let first = get_or_create_local_learner_id(&connection).unwrap();
        let parsed = Uuid::parse_str(&first).unwrap();
        assert_eq!(parsed.get_version(), Some(Version::Random));
        assert_eq!(first, get_or_create_local_learner_id(&connection).unwrap());

        let identity_rows: i64 = connection
            .query_row("SELECT COUNT(*) FROM local_identity", [], |row| row.get(0))
            .unwrap();
        assert_eq!(identity_rows, 1);
    }

    #[test]
    fn local_identity_migration_preserves_existing_progress_rows() {
        let connection = Connection::open_in_memory().unwrap();
        connection
            .execute_batch(
                "CREATE TABLE lesson_progress (
                    learner_id TEXT NOT NULL CHECK(length(trim(learner_id)) > 0),
                    lesson_id TEXT NOT NULL CHECK(length(trim(lesson_id)) > 0),
                    completed_step_ids_json TEXT NOT NULL CHECK(json_valid(completed_step_ids_json)),
                    updated_at TEXT NOT NULL,
                    content_version TEXT NOT NULL,
                    PRIMARY KEY (learner_id, lesson_id)
                );
                PRAGMA user_version = 1;",
            )
            .unwrap();
        connection
            .execute(
                "INSERT INTO lesson_progress
                    (learner_id, lesson_id, completed_step_ids_json, updated_at, content_version)
                 VALUES ('legacy-untrusted-id', 'lesson-001', '[\"step-1\"]', '2026-11-04T06:00:00Z', 'content-1')",
                [],
            )
            .unwrap();

        initialize_database(&connection).unwrap();
        let local_id = get_or_create_local_learner_id(&connection).unwrap();

        let legacy_steps: String = connection
            .query_row(
                "SELECT completed_step_ids_json FROM lesson_progress
                 WHERE learner_id = 'legacy-untrusted-id' AND lesson_id = 'lesson-001'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(legacy_steps, "[\"step-1\"]");
        assert!(read_progress(&connection, &local_id, "lesson-001")
            .unwrap()
            .is_none());
    }

    #[test]
    fn progress_is_isolated_by_the_native_learner_identity() {
        let connection = Connection::open_in_memory().unwrap();
        initialize_database(&connection).unwrap();
        save_progress(&connection, LEARNER_A, &sample_progress(&["step-1"])).unwrap();
        save_progress(&connection, LEARNER_B, &sample_progress(&["step-2"])).unwrap();

        assert_eq!(
            read_progress(&connection, LEARNER_A, "lesson-001")
                .unwrap()
                .unwrap()
                .completed_step_ids,
            vec!["step-1"]
        );
        assert_eq!(
            read_progress(&connection, LEARNER_B, "lesson-001")
                .unwrap()
                .unwrap()
                .completed_step_ids,
            vec!["step-2"]
        );
        assert!(read_progress(&connection, LEARNER_A, "missing-lesson")
            .unwrap()
            .is_none());
    }

    #[test]
    fn saving_the_same_learner_lesson_updates_one_record() {
        let connection = Connection::open_in_memory().unwrap();
        initialize_database(&connection).unwrap();
        save_progress(&connection, LEARNER_A, &sample_progress(&["step-1"])).unwrap();
        save_progress(
            &connection,
            LEARNER_A,
            &sample_progress(&["step-1", "step-2"]),
        )
        .unwrap();

        let count: i64 = connection
            .query_row("SELECT COUNT(*) FROM lesson_progress", [], |row| row.get(0))
            .unwrap();
        assert_eq!(count, 1);
        assert_eq!(
            read_progress(&connection, LEARNER_A, "lesson-001")
                .unwrap()
                .unwrap()
                .completed_step_ids,
            vec!["step-1", "step-2"]
        );
    }

    #[test]
    fn rejects_non_uuid_v4_learner_ids_and_invalid_lesson_ids() {
        let connection = Connection::open_in_memory().unwrap();
        initialize_database(&connection).unwrap();

        assert!(validate_learner_id("learner-a").is_err());
        assert!(validate_learner_id("00000000-0000-1000-8000-000000000001").is_err());
        assert!(validate_lesson_id("").is_err());
        assert!(validate_lesson_id(" lesson-001").is_err());
        assert!(validate_lesson_id(&"x".repeat(161)).is_err());
        assert!(read_progress(&connection, "learner-a", "lesson-001").is_err());
    }

    #[test]
    fn lists_only_the_selected_learners_progress_in_stable_lesson_order() {
        let connection = Connection::open_in_memory().unwrap();
        initialize_database(&connection).unwrap();

        let mut second = sample_progress(&["step-2"]);
        second.lesson_id = "lesson-002".into();
        let first = sample_progress(&["step-1"]);
        let other_learner = sample_progress(&["private-step"]);

        save_progress(&connection, LEARNER_A, &second).unwrap();
        save_progress(&connection, LEARNER_B, &other_learner).unwrap();
        save_progress(&connection, LEARNER_A, &first).unwrap();

        let listed = list_progress(&connection, LEARNER_A).unwrap();
        assert_eq!(
            listed.iter().map(|item| item.lesson_id.as_str()).collect::<Vec<_>>(),
            vec!["lesson-001", "lesson-002"]
        );
        assert!(listed.iter().all(|item| item.learner_id == LEARNER_A));
        assert_eq!(listed[0].completed_step_ids, vec!["step-1"]);
        assert_eq!(listed[1].completed_step_ids, vec!["step-2"]);
        assert!(list_progress(&connection, LEARNER_B)
            .unwrap()
            .iter()
            .all(|item| item.learner_id == LEARNER_B));
    }

    #[test]
    fn progress_and_local_identity_survive_closing_and_reopening_the_database() {
        let path = temporary_database_path();
        let first_identity;
        {
            let connection = open_database(&path).unwrap();
            first_identity = get_or_create_local_learner_id(&connection).unwrap();
            save_progress(
                &connection,
                &first_identity,
                &sample_progress(&["step-1", "step-3"]),
            )
            .unwrap();
        }
        {
            let connection = open_database(&path).unwrap();
            let reopened_identity = get_or_create_local_learner_id(&connection).unwrap();
            assert_eq!(reopened_identity, first_identity);
            let restored = read_progress(&connection, &reopened_identity, "lesson-001")
                .unwrap()
                .unwrap();
            assert_eq!(restored.learner_id, first_identity);
            assert_eq!(restored.completed_step_ids, vec!["step-1", "step-3"]);
            assert_eq!(restored.updated_at, "2026-11-04T06:00:00Z");
            assert_eq!(restored.content_version, "content-1");
        }
        let _ = fs::remove_file(&path);
        let _ = fs::remove_file(path.with_extension("sqlite3-wal"));
        let _ = fs::remove_file(path.with_extension("sqlite3-shm"));
    }
}
