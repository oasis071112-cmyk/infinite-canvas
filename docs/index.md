# IonAiLabs Infinite Canvas Documentation Index

This file is the AI-oriented documentation map. User-facing pages live under `docs/content/docs/`.

## Start here

- `overview/quick-start.mdx`: start the complete frontend and Node API.
- `overview/features.mdx`: current product capabilities and data boundaries.
- `overview/docker.mdx`: production Compose, Nginx, SQLite, backup, and outbound-traffic notes.
- `development/local-development.mdx`: source-development setup.
- `canvas/`: canvas operation and shortcut references.
- `progress/pending-test.mdx`: implemented changes awaiting manual verification.
- `progress/todo.mdx`: future work.
- `support/security.mdx`: responsible disclosure and security boundaries.

## Current architecture

The browser stores canvas projects, generated and imported media, audio, assets, and full generation history in IndexedDB. It calls only same-origin `/api` for AI work. The Node service stores anonymous sessions, AES-256-GCM-encrypted OpenAI-compatible provider settings, model assignments, and prompt-free call summaries in SQLite. WebDAV, native Gemini, native Volcengine Ark, and custom request scripts are not supported.
