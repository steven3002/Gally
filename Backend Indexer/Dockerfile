# Gally Backend Indexer — long-running event ingester + REST/WebSocket API.
# Multi-stage: compile a static-ish release binary, then ship a slim runtime image.
# No database is needed at build time (all sqlx queries are runtime-built, not the
# compile-time `query!` macro), so the build is fully self-contained.

# ---- build stage ----
FROM rust:1-bookworm AS build
WORKDIR /app
# Copy the whole crate (migrations are embedded into the binary via sqlx::migrate!,
# so they must be present at compile time).
COPY . .
RUN cargo build --release --bin gally_indexer

# ---- runtime stage ----
FROM debian:bookworm-slim
# ca-certificates: TLS to the Sui fullnode (HTTPS) and to Postgres (rustls).
RUN apt-get update \
 && apt-get install -y --no-install-recommends ca-certificates \
 && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY --from=build /app/target/release/gally_indexer /usr/local/bin/gally_indexer
ENV RUST_LOG=info
# Informational; the app binds $PORT (or API_BIND, or 8080).
EXPOSE 8080
CMD ["gally_indexer"]
