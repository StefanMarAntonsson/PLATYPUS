# Publishing a release

PLATYPUS releases are built by GitHub Actions. Pushing a version tag creates a
GitHub Release containing the Linux `.deb` and `.AppImage` installers, generated
release notes, signed AppImage updater artifacts, `latest.json`, and a
`SHA256SUMS` file.

## Updater signing key

Tauri updater signatures establish the trust chain between an installed
AppImage and every future update. The public key is committed in
`src-tauri/tauri.conf.json`. The password-protected private key and its password
must be stored in the repository's GitHub Actions secrets as:

- `TAURI_SIGNING_PRIVATE_KEY`
- `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`

Keep an encrypted backup of both values outside GitHub. Do not commit the
private key, paste it into an issue or workflow, or regenerate it for routine
releases. Losing the key or password prevents existing installations from
accepting future updates. Key rotation requires a separately planned transition
release signed by the existing key.

The release workflow refuses to produce updater artifacts when the signing
secrets are unavailable. Tauri Action creates `latest.json` from the signed
AppImage and uploads it with the release; do not construct or edit this file by
hand.

## Prepare the version

Choose a semantic version such as `0.1.0` and update every version source with
the checked version command:

```sh
vp run version:set -- 0.1.0
```

This updates `package.json`, `src-tauri/tauri.conf.json`,
`src-tauri/Cargo.toml`, and the PLATYPUS entry in `src-tauri/Cargo.lock`
together. CI runs `vp run version:check` to reject drift between them.

Then validate the release commit:

```sh
cargo check --manifest-path src-tauri/Cargo.toml
vp check
vp test
cargo fmt --check --manifest-path src-tauri/Cargo.toml
cargo test --locked --manifest-path src-tauri/Cargo.toml
```

Commit and push those version changes to `main` before tagging the commit.

## Publish

For version `0.1.0`, create and push an annotated `v0.1.0` tag:

```sh
git tag -a v0.1.0 -m "PLATYPUS 0.1.0"
git push origin v0.1.0
```

The release workflow verifies that the tag and all application versions
match. If validation, signing, or packaging fails, it does not publish a partial
release.
Follow the run on the repository's **Actions** page. When it succeeds, the
installers are available from **Releases**.

The `.deb` remains a normal manually downloaded Debian package and is upgraded
with `sudo apt install ./PLATYPUS_<version>_amd64.deb`. Only AppImage
installations offer in-app replacement. Users on a version from before updater
support must manually install the first updater-enabled release once.

Do not move an existing release tag. Fix the problem, choose a new patch
version, and publish a new tag instead.
