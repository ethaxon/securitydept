FROM docker:28-cli

RUN apk add --no-cache bash curl ca-certificates

RUN ARCH="$(apk --print-arch)" \
 && case "${ARCH}" in \
        x86_64) BIN_ARCH="amd64" ;; \
        aarch64) BIN_ARCH="arm64" ;; \
        *) echo "unsupported arch: ${ARCH}" >&2; exit 1 ;; \
    esac \
 && KIND_VERSION="v0.27.0" \
 && curl -fsSL -o /usr/local/bin/kind "https://kind.sigs.k8s.io/dl/${KIND_VERSION}/kind-linux-${BIN_ARCH}" \
 && chmod +x /usr/local/bin/kind \
 && K3D_VERSION="v5.8.3" \
 && curl -fsSL -o /usr/local/bin/k3d "https://github.com/k3d-io/k3d/releases/download/${K3D_VERSION}/k3d-linux-${BIN_ARCH}" \
 && chmod +x /usr/local/bin/k3d \
 && KUBECTL_VERSION="v1.31.2" \
 && curl -fsSL -o /usr/local/bin/kubectl "https://dl.k8s.io/release/${KUBECTL_VERSION}/bin/linux/${BIN_ARCH}/kubectl" \
 && chmod +x /usr/local/bin/kubectl

CMD ["sleep", "infinity"]