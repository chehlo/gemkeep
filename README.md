# GemKeep

GemKeep is a personal, high-performance photo selection tool designed for photographers who return from a shoot with thousands of RAW+JPEG files and need to quickly find and keep the real gems.

It offers:
- **Keyboard-first workflow** with instant navigation and no interruptions
- **Stack-based grouping** (auto-detected)
- **Linear multi-round refinement** (micro per stack + macro across finalists)
- **RAW + JPEG pair handling** as single logical units (fast JPEG previews, explicit RAW toggle)
- **Performance-focused** architecture (Rust for image pipelines, multi-level caching)
- **Traceable & crash-resilient** decisions via SQLite and operation logs

Built with Electron (UI), Node.js (backend), and Rust (native image processing via NAPI-RS). Cross-platform design (Linux, macOS , Windows). Licensed under Apache 2.0.

Perfect for personal use on large photo tours, weddings, or portfolio reviews.  
