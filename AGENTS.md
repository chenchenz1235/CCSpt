# CCSpt navigation repository

This repository is a public catalog, not an installable skill. For requests to install CCSpt skills, first read skills/README.md and skills/catalog.json. Resolve selected names and dependencies, using each catalog entry's repo, ref and path. The default set installs all three stable skills. Do not scan labs as approved installation targets or copy this entire repository into a skills directory.

Preserve sibling directories for ccspt-code-review and its two specialty dependencies. Use the host's supported installer. If unavailable, explain the limitation. Inspect existing installations and compare versions before any replacement; back up changes, respect current user authorization, and do not silently delete other skills. Do not alter unrelated Codex configuration or use another employee's credentials.

Catalog entries pin a reviewed source commit. Do not silently substitute main. Catalog updates must verify the new source, version, references and dependency closure. Source workflows that perform update checks can discover a newer version and must follow their own update policy.

For publishing tools, read CONTRIBUTING.md and the tool's own README. Keep archives in GitHub Release assets rather than Git history. Do not upload local data/, tasks, backups, logs, credentials or customer projects. Publishing publicly or moving experimental tools to stable requires corresponding user authorization. Existing authorization in the conversation remains valid.
