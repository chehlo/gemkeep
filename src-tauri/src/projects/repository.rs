use crate::projects::model::Project;
use rusqlite::{params, Connection};

pub fn insert_project(conn: &Connection, name: &str, slug: &str) -> anyhow::Result<Project> {
    let now = chrono::Utc::now().to_rfc3339();
    conn.execute(
        "INSERT INTO projects (name, slug, created_at) VALUES (?1, ?2, ?3)",
        params![name, slug, now],
    )?;
    let id = conn.last_insert_rowid();
    Ok(Project {
        id,
        name: name.to_string(),
        slug: slug.to_string(),
        created_at: now,
        last_opened_at: None,
    })
}

pub fn list_projects_in_db(conn: &Connection) -> anyhow::Result<Vec<Project>> {
    let mut stmt =
        conn.prepare("SELECT id, name, slug, created_at, last_opened_at FROM projects")?;
    let rows = stmt.query_map([], |row| {
        Ok(Project {
            id: row.get(0)?,
            name: row.get(1)?,
            slug: row.get(2)?,
            created_at: row.get(3)?,
            last_opened_at: row.get(4)?,
        })
    })?;
    Ok(rows.collect::<Result<_, _>>()?)
}

pub fn get_project_by_slug(conn: &Connection, slug: &str) -> anyhow::Result<Project> {
    conn.query_row(
        "SELECT id, name, slug, created_at, last_opened_at FROM projects WHERE slug = ?1",
        params![slug],
        |row| {
            Ok(Project {
                id: row.get(0)?,
                name: row.get(1)?,
                slug: row.get(2)?,
                created_at: row.get(3)?,
                last_opened_at: row.get(4)?,
            })
        },
    )
    .map_err(Into::into)
}

pub fn update_last_opened(conn: &Connection, id: i64) -> anyhow::Result<()> {
    let now = chrono::Utc::now().to_rfc3339();
    conn.execute(
        "UPDATE projects SET last_opened_at = ?1 WHERE id = ?2",
        params![now, id],
    )?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::run_migrations;

    fn in_memory_conn() -> Connection {
        let conn = Connection::open_in_memory().unwrap();
        run_migrations(&conn).unwrap();
        conn
    }

    #[test]
    fn test_insert_and_get_by_slug() {
        let conn = in_memory_conn();
        let project = insert_project(&conn, "Iceland 2024", "iceland-2024").unwrap();
        assert_eq!(project.id, 1);
        assert_eq!(project.name, "Iceland 2024");
        assert_eq!(project.slug, "iceland-2024");
        assert!(project.last_opened_at.is_none());

        let fetched = get_project_by_slug(&conn, "iceland-2024").unwrap();
        assert_eq!(fetched.id, project.id);
        assert_eq!(fetched.name, project.name);
        assert_eq!(fetched.slug, project.slug);
    }

    #[test]
    fn test_list_returns_all_rows() {
        let conn = in_memory_conn();
        insert_project(&conn, "Project A", "project-a").unwrap();
        insert_project(&conn, "Project B", "project-b").unwrap();
        insert_project(&conn, "Project C", "project-c").unwrap();

        let projects = list_projects_in_db(&conn).unwrap();
        assert_eq!(projects.len(), 3);
    }

    #[test]
    fn test_duplicate_slug_returns_error() {
        let conn = in_memory_conn();
        insert_project(&conn, "My Project", "my-project").unwrap();
        let result = insert_project(&conn, "My Project Copy", "my-project");
        assert!(result.is_err(), "Duplicate slug should return an error");
    }

    #[test]
    fn test_update_last_opened_changes_timestamp() {
        let conn = in_memory_conn();
        let project = insert_project(&conn, "Test Project", "test-project").unwrap();
        assert!(project.last_opened_at.is_none());

        update_last_opened(&conn, project.id).unwrap();

        let fetched = get_project_by_slug(&conn, "test-project").unwrap();
        assert!(
            fetched.last_opened_at.is_some(),
            "last_opened_at should be set after update"
        );
    }

    #[test]
    fn test_get_by_slug_not_found() {
        let conn = in_memory_conn();
        let result = get_project_by_slug(&conn, "nonexistent");
        assert!(result.is_err());
    }
}
