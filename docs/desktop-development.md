# Desktop development

PLATYPUS uses Tauri 2 to package the SvelteKit SPA as a Linux desktop application. Desktop library state and source connections are persisted locally in SQLite. Connector HTTP requests run through the native backend with host, redirect, timeout, and response-size restrictions. Native credential storage remains a later milestone, so authenticated source templates are not executable yet.

## Arch Linux prerequisites

Install Rust, Bun, and the WebKitGTK build dependencies:

```sh
sudo pacman -S --needed rust bun webkit2gtk-4.1 libappindicator-gtk3 librsvg base-devel
```

Install JavaScript dependencies with Vite+:

```sh
vp install
```

## Run and package

Use Vite+ to run the project scripts:

```sh
vp run desktop:dev
vp run desktop:build
```

`desktop:dev` starts Vite on port 1420 and opens the native PLATYPUS window. `desktop:build` compiles the desktop binary and produces an AppImage in `src-tauri/target/release/bundle/appimage/` when run from a compatible release environment.

On Linux, PLATYPUS disables WebKitGTK's DMA-BUF renderer before creating the window. This avoids startup crashes and blank windows seen with some Wayland, XWayland, NVIDIA, and virtual-GPU configurations. The setting is applied by the application itself, so `GDK_BACKEND` overrides should not be necessary.

### AppImage release builds

Developing and compiling the desktop application on Arch is supported. For portable AppImage release artifacts, build on an Ubuntu CI runner or container. Tauri's bundled `linuxdeploy` currently cannot strip the RELR relocations used by current Arch system libraries, so an AppImage bundle may fail there even when the application binary builds successfully.

The desktop repository stores each legacy-data area in SQLite and applies schema migrations transactionally. Before a schema migration, an existing database is copied beside the database as a timestamped `.pre-migration-*.bak` file. On first launch after upgrading from the Phase 2 build, its local-storage library is imported into SQLite and removed only after that write succeeds.

The **Save backup** action writes a portable JSON backup to the `backups` directory below the platform application-data directory and displays the exact path. Source templates and credentials are excluded from library backups.
