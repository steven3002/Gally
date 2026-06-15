//! Database layer: connection pool, migration runner, and query functions.

pub mod models;
pub mod queries;

use anyhow::{Context, Result};
use sqlx::postgres::PgPoolOptions;
use sqlx::PgPool;

/// Open a connection pool to PostgreSQL.
pub async fn connect(database_url: &str) -> Result<PgPool> {
    PgPoolOptions::new()
        .max_connections(10)
        .connect(database_url)
        .await
        .context("failed to connect to PostgreSQL")
}

/// Apply all pending migrations (embedded at compile time from `src/db/migrations`).
pub async fn run_migrations(pool: &PgPool) -> Result<()> {
    sqlx::migrate!("src/db/migrations")
        .run(pool)
        .await
        .context("failed to run database migrations")?;
    Ok(())
}
