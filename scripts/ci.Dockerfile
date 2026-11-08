ARG NODE_VERSION=24
FROM node:${NODE_VERSION}-bookworm
ARG PNPM_VERSION
ARG RUST_VERSION
LABEL org.iori.ci.image="scaffold"
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential curl ca-certificates git gh pkg-config file \
    libwebkit2gtk-4.1-dev libxdo-dev libssl-dev \
    libayatana-appindicator3-dev librsvg2-dev \
    && rm -rf /var/lib/apt/lists/*
ENV RUSTUP_HOME=/opt/rustup CARGO_HOME=/opt/cargo
ENV PATH="/opt/cargo/bin:${PATH}"
RUN curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs -o /tmp/rustup-init.sh \
    && sh /tmp/rustup-init.sh -y --profile minimal --default-toolchain "${RUST_VERSION}" \
    && rustup component add rustfmt clippy \
    && rm /tmp/rustup-init.sh
RUN corepack enable && corepack prepare "pnpm@${PNPM_VERSION}" --activate
WORKDIR /work
