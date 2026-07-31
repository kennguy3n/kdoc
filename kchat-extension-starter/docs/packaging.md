# Packaging

This guide covers building, signing, and publishing a `.kcz` package.

## Build

```bash
yarn build
```

Runs two Vite builds:
1. **Client** → `dist/client/index.html` + assets
2. **Server** → `dist/server/index.js`

The build must exit 0 before packaging. The host validator rejects
malformed manifests at install time.

## Package (unsigned)

```bash
yarn package
```

Runs `yarn build` then `kc extension:package`, producing:

```text
artifacts/
└── your-vendor.your-extension-0.1.0.kcz
```

The `.kcz` is a zip archive with `manifest.json` at the root and
`dist/` contents. It can be installed via **Settings → Developer →
Extensions → Install from .kcz**.

## Sign

Signing embeds an Ed25519 signature in `META-INF/signature.v1.json`
inside the archive. The host verifies the signature against compiled-
in trust roots at install time.

### Generate a keypair

```bash
kc extension:keygen
# → writes private.pem + public.pem in the current directory
```

### Get your public key trusted

This is a manual, review-gated step:

1. Send your `public.pem` to the KChat maintainer team.
2. They add it to the host's trust-root manifest
   (`keys/trust-roots.json`) and regenerate the compiled trust roots.
3. They give you a `key-id` (e.g. `your-vendor-root-2026-01`) and
   confirm your `publisher` slug.

Until your key is in the trust roots, signed packages will fail
verification with `SIGNATURE_TRUST_ROOT_UNKNOWN`.

### Build + sign

```bash
yarn package -- --sign \
  --key ./private.pem \
  --key-id your-vendor-root-2026-01 \
  --publisher your-vendor
```

Or call `kc` directly:

```bash
yarn build
kc extension:package --sign \
  --key ./private.pem \
  --key-id your-vendor-root-2026-01 \
  --publisher your-vendor
```

Output:

```text
artifacts/
├── your-vendor.your-extension-0.1.0.kcz
└── your-vendor.your-extension-0.1.0.kcz.sha256
```

## Publish an update feed

The host auto-updater polls a `latest.yml` feed. To emit one:

```bash
yarn package -- --feed \
  --key ./private.pem \
  --key-id your-vendor-root-2026-01 \
  --publisher your-vendor \
  --base-url https://your-cdn.com/ext
```

This produces `artifacts/latest.yml` alongside the `.kcz`. The feed
contains the version, package URL, SHA-256 digest, and a detached
Ed25519 signature.

### CDN / S3 layout

```text
https://your-cdn.com/ext/
└── your-vendor.your-extension/
    ├── latest.yml                                    # feed (short cache)
    ├── your-vendor.your-extension-0.1.0.kcz          # immutable
    └── your-vendor.your-extension-0.0.9.kcz          # prior versions
```

**Publish rules:**

1. Upload the `.kcz` first, the `latest.yml` second — the feed must
   never advertise a package that is not yet readable.
2. `.kcz`: `Cache-Control: public, max-age=31536000, immutable`
3. `latest.yml`: `Cache-Control: public, max-age=300, must-revalidate`
4. HTTPS only — non-HTTPS URLs fail host schema validation.

## Pre-distribution checklist

1. `manifest.json` validates in the host (id not reserved, every
   path/view/action ref resolves, every command id is declared).
2. `entry.client` and `entry.server` exist under `dist/`.
3. Bundle uses only relative asset URLs (`./assets/...`).
4. `.kcz` puts `manifest.json` at the archive root, uses forward-slash
   entry names, no symlinks or absolute paths.
5. Install → enable → action → route change → disable → uninstall
   succeeds end-to-end on a clean profile.
6. Re-installing the same `.kcz` is idempotent; bumping `version` and
   re-installing produces a separate install root.
