FROM docker:28-cli

RUN apk add --no-cache bash curl ca-certificates

RUN download() { \
    url="$1"; \
    output="$2"; \
    curl --fail --show-error --silent --location \
    --retry 8 \
    --retry-all-errors \
    --retry-delay 2 \
    --connect-timeout 30 \
    --max-time 300 \
    --http1.1 \
    --tlsv1.2 \
    -o "${output}" \
    "${url}"; \
    } \
    && ARCH="$(apk --print-arch)" \
    && case "${ARCH}" in \
    x86_64) BIN_ARCH="amd64" ;; \
    aarch64) BIN_ARCH="arm64" ;; \
    *) echo "unsupported arch: ${ARCH}" >&2; exit 1 ;; \
    esac \
    && KIND_VERSION="v0.27.0" \
    && download "https://kind.sigs.k8s.io/dl/${KIND_VERSION}/kind-linux-${BIN_ARCH}" /usr/local/bin/kind \
    && chmod +x /usr/local/bin/kind \
    && K3D_VERSION="v5.8.3" \
    && download "https://github.com/k3d-io/k3d/releases/download/${K3D_VERSION}/k3d-linux-${BIN_ARCH}" /usr/local/bin/k3d \
    && chmod +x /usr/local/bin/k3d \
    && KUBECTL_VERSION="v1.31.2" \
    && download "https://dl.k8s.io/release/${KUBECTL_VERSION}/bin/linux/${BIN_ARCH}/kubectl" /usr/local/bin/kubectl \
    && chmod +x /usr/local/bin/kubectl

CMD ["sleep", "infinity"]
