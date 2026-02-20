# Milestone 2 — Project Management (Hardened + Deletion + Multi-Project + Negative Testing)

## Goal

Enable users to:

- Create projects
- Open projects
- List multiple projects
- Delete projects
- Automatically reopen the last project

Each project is:

- Fully isolated
- Identified by immutable slug
- Crash-safe
- Internally consistent
- Safe under negative and edge conditions

---

# 1. Core Architectural Decisions

## 1.1 Canonical Project Identity

- Slug is the canonical external project identifier.
- Slug is immutable after creation.
- Slug defines directory name.
- Database `id` is internal only.

Display name may change in the future. Slug and folder name never change.

---

## 1.2 Project Validity Rule

A project is valid only if:

- `project.db` exists
- DB opens successfully
- `projects` table contains exactly one row
- Migrations succeed

Invalid projects:

- Are skipped during listing
- Logged
- Never crash the application

---

## 1.3 AppState Structure & Invariants

```rust
pub struct AppState {
    pub db: Mutex<Option<Connection>>,
    pub active_project: Mutex<Option<Project>>,
    pub gemkeep_home: PathBuf,
}
````

### Invariants

* If `db` is `Some`, `active_project` must be `Some`
* If `active_project` is `Some`, `db` must be `Some`
* Both are `None` only when no project is open

### Lock Order

Always lock:

1. `db`
2. `active_project`

Never reverse order.

---

## 1.4 Command Guard Rule

All Tauri commands must:

* Explicitly verify `active_project`
* Return structured error if not set
* Never panic

---

# 2. Directory Structure

```
~/.gem-keep/
├── config.json
└── projects/
    └── <slug>/
        ├── project.db
        ├── cache/
        │   └── thumbnails/
        └── logs/
            └── operation.log
```

Created on first launch.

---

# 3. Config File

```json
{
  "last_opened_slug": "my-project"
}
```

### Write Strategy

* Write to temp file
* Atomic rename

### Missing Project Behavior

If slug in config:

* Does not exist
* Is invalid
* DB corrupted

Then:

* Ignore silently
* Return `None`
* Show ProjectList

---

# 4. Slug Generation

Rules:

1. Lowercase
2. Replace non `[a-z0-9]` with `-`
3. Trim `-`
4. Truncate to 60 chars
5. Empty → `"project"`
6. Ensure uniqueness via filesystem check
7. Append `-2`, `-3`, etc. if needed

Slug immutable after creation.

---

# 5. Crash-Safe Project Creation

## Flow

```
create_project(name):
    generate slug
    ensure directory not exists
    create project directory
    create project.db
    open DB
    run migrations
    insert project row

    if failure before insert:
        delete project directory entirely
        return error

    create cache/ and logs/
    write PROJECT_CREATED log
    update config.json
    open project
```

### Rule

If DB insert fails:

* Entire directory deleted
* No zombie directories

---

# 6. Delete Project (NEW)

## Command

```
delete_project(slug)
```

## Behavior

1. Validate project exists
2. If project is currently active:

   * Close DB
   * Clear AppState
3. Delete project directory recursively
4. Remove slug from config if it matches `last_opened_slug`
5. Log deletion (global log or console)
6. Return success

## Safety Rules

* Deletion must be atomic at directory level
* If deletion fails midway → return error
* No partial cleanup allowed

## UI Rule

* Deletion requires explicit confirmation (modal allowed here)
* Deletion cannot happen during indexing (future rule)

---

# 7. Multiple Project Handling (NEW)

System must support:

* Creating multiple projects
* Opening any project independently
* Switching between projects safely
* Deleting one project without affecting others

## Test Requirements

* Create 3+ projects
* Ensure all appear in list
* Open each successfully
* Delete one → others remain intact
* Config updates correctly

---

# 8. list_projects Strategy

1. Scan `projects/`
2. For each subdirectory:

   * Check `project.db`
   * Open DB
   * Run migrations
   * Query `projects` table
3. On failure:

   * Log warning
   * Skip project
   * Continue

---

# 9. open_project Flow

```
open_project(slug):
    validate directory
    open DB
    run migrations
    fetch project row

    lock db → replace connection
    lock active_project → set project

    update last_opened_at
    write config.json
    log PROJECT_OPENED
```

AppState invariants must hold.

---

# 10. Logging Format

```
[ISO-8601 UTC] EVENT_NAME key=value key=value
```

Examples:

```
[2026-02-19T12:34:11Z] PROJECT_CREATED slug=iceland-2024
[2026-02-19T12:35:01Z] PROJECT_OPENED slug=iceland-2024
[2026-02-19T12:40:22Z] PROJECT_DELETED slug=wedding-2025
```

---

# 11. Negative Testing (NEW)

## 11.1 Creation Failures

* Attempt create with existing slug → error
* Disk permission denied → error
* DB creation failure → directory cleaned up
* Migration failure → directory cleaned up

## 11.2 Corrupt Project Directory

* Missing DB → skipped in list
* Corrupt DB → skipped in list
* Missing `projects` row → skipped
* Invalid schema_version → skipped

App must not crash.

## 11.3 Deletion Failures

* Delete non-existing slug → error
* Delete directory with permission issue → error
* Delete active project → AppState reset correctly

## 11.4 Config Corruption

* Malformed JSON → ignore config, recreate clean file
* Missing file → treated as no last project

## 11.5 Concurrency Edge

* Rapid open/delete/open calls must not violate AppState invariants
* Lock order must prevent deadlock

---

# 12. Frontend Requirements

ProjectList:

* Show all projects
* Allow deletion
* Disable Create if:

  * Name empty
  * Slug invalid
  * Slug exists
* Auto-open last valid project
* Confirmation required for delete
* No modals except delete confirmation

---

# 13. Tests

## Slug

* Normalization
* Uniqueness
* Truncation
* Validation

## Repository

* Insert/get/list
* Duplicate slug rejection
* Update last_opened

## Manager

* Directory creation
* Crash-safe cleanup
* Recursive delete
* Config write-rename
* Corrupt config recovery

## Integration

* Create multiple projects
* Switch between them
* Delete one → others intact
* Delete active project → AppState cleared
* Corrupt project skipped
* Missing config handled
* Invariants preserved

---

# Definition of Done

* Multiple projects supported
* Project deletion implemented
* Negative testing scenarios covered
* Crash-safe creation enforced
* AppState invariants guaranteed
* No panics under invalid conditions
* Config resilient to corruption
* All tests pass


