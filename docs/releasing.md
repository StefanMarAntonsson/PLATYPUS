# Publishing a release

PLATYPUS releases are built by GitHub Actions. Pushing a version tag creates a
GitHub Release containing the Linux `.deb` and `.AppImage` installers, generated
release notes, and a `SHA256SUMS` file.

## Prepare the version

Choose a semantic version such as `0.1.0` and set that same version in:

- `package.json`
- `src-tauri/tauri.conf.json`
- `src-tauri/Cargo.toml`

Then refresh the Rust lockfile and validate the release commit:

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

The release workflow verifies that the tag and all three application versions
match. If validation or packaging fails, it does not publish a partial release.
Follow the run on the repository's **Actions** page. When it succeeds, the
installers are available from **Releases**.

Do not move an existing release tag. Fix the problem, choose a new patch
version, and publish a new tag instead.
