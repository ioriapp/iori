FROM ubuntu:22.04
ENV DEBIAN_FRONTEND=noninteractive
RUN sed -i 's/^# deb-src /deb-src /' /etc/apt/sources.list \
    && apt-get update && apt-get install -y --no-install-recommends \
    build-essential curl ca-certificates file git pkg-config patchelf \
    libwebkit2gtk-4.1-dev libssl-dev librsvg2-dev libfuse2 \
    xdg-utils libsecret-1-dev xvfb xauth dbus-x11 webkit2gtk-driver \
    && rm -rf /var/lib/apt/lists/*
# AppImage type2-runtime 20251108, commit dd6cebedcbddde9c82f89b011e8e1d40b6e43868.
RUN curl -fsSL https://github.com/AppImage/type2-runtime/releases/download/20251108/runtime-x86_64 -o /opt/appimage-runtime \
    && echo '2fca8b443c92510f1483a883f60061ad09b46b978b2631c807cd873a47ec260d  /opt/appimage-runtime' | sha256sum -c -
ARG NODE_VERSION=24.22.1
RUN curl -fsSL https://nodejs.org/dist/v${NODE_VERSION}/node-v${NODE_VERSION}-linux-x64.tar.xz \
    | tar -xJ --strip-components=1 -C /usr/local \
    && npm install -g pnpm@11.18.0
ENV CARGO_HOME=/opt/cargo RUSTUP_HOME=/opt/rustup PATH=/opt/cargo/bin:$PATH
RUN curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs \
    | sh -s -- -y --profile minimal --default-toolchain 1.98.1
RUN apt-get update && apt-get install -y --no-install-recommends gnome-keyring pkexec
WORKDIR /source
