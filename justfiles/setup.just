# Workspace bootstrap and shared environments
setup:
    mise install
    pnpm install
    cargo check --workspace --all-features
    just setup-docs

setup-docs:
    cd docsite && pnpm install

setup-distrobox:
    distrobox create --name playwright-env --image ubuntu:24.04
    distrobox enter playwright-env -- bash -c "mise trust 2> /dev/null && pnpm exec playwright install --with-deps webkit"

[windows]
setup-playwright:
    pnpm exec playwright install --with-deps webkit chromium firefox

[macos]
setup-playwright:
    pnpm exec playwright install --with-deps webkit chromium firefox

[linux]
setup-playwright:
    #!/usr/bin/env bash
    set -euo pipefail
    # if is debian/ubuntu, we can install playwright dependencies via playwright install
    # if is arch/manjaro/cachyos, we need to install playwright dependencies via pacman
    # for other distros, please refer to https://playwright.dev/docs/installation#linux-dependencies and install dependencies via system package manager
    if [[ -f /etc/os-release ]] && grep -Eq "debian|ubuntu" /etc/os-release; then
        pnpm exec playwright install --with-deps webkit chromium firefox
    elif [[ -f /etc/os-release ]] && grep -Eq "arch|manjaro|cachyos" /etc/os-release; then
        sudo pacman -S --needed --noconfirm chromium firefox
        just setup-distrobox
    else
        echo "Please install chromium and firefox via your system package manager, then run 'just install-playwright-deps'."
    fi
