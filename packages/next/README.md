<div align="center">
  <a href="https://github.com/openuiai/next.js">
    <img alt="OpenNext.js logo" src="assets/OpenNext.js.png" height="128">
  </a>
  <h1>OpenNext.js</h1>

<a href="https://github.com/openuiai/next.js"><img alt="Fork status" src="https://img.shields.io/badge/FORK-Self%20Hosted%20First-green.svg?style=for-the-badge&labelColor=000"></a>
<a href="https://www.npmjs.com/package/@openuiai/next"><img alt="NPM version" src="https://img.shields.io/badge/NPM-@openuiai/next-blue.svg?style=for-the-badge&labelColor=000000"></a>
<a href="https://github.com/openuiai/next.js/blob/main/license.md"><img alt="License" src="https://img.shields.io/npm/l/next.svg?style=for-the-badge&labelColor=000000"></a>

</div>

## What is OpenNext.js?

A **self-hosted focused** fork of Next.js v15.3.3 that removes platform limitations and adds features like native WebSocket support, unrestricted Node.js middleware, and build-time image optimization.

**Built for teams who control their infrastructure and want the full power of Node.js without artificial constraints.**

### Our Philosophy

**Frameworks should define capabilities, not platforms.** We believe deployment targets should adapt to support framework features, not the other way around. When platforms dictate what a framework can do, innovation stops and developers suffer.

## Quick Start

```bash
npm uninstall next # Bye artificially imposed limitations
npm install @openuiai/next # Hello unrestricted Node.js
npm run dev  # Your existing app works unchanged, as long as you are self-hosting
```

## Key Features

> ⚠️ **WORK IN PROGRESS:** This fork officially started in August 2025 and is currently in active development. Features are being implemented and tested. Use at your own discretion for production workloads.

- **Native WebSocket Support:** SOCKET exports in API routes
  - Solves: [#58698](https://github.com/vercel/next.js/discussions/58698), [#34856](https://github.com/vercel/next.js/discussions/34856), [#14950](https://github.com/vercel/next.js/discussions/14950)
- **Unrestricted Middleware:** Full Node.js APIs, database connections, file system access
  - Solves: [#46722](https://github.com/vercel/next.js/discussions/46722), [#71727](https://github.com/vercel/next.js/discussions/71727), [#35517](https://github.com/vercel/next.js/discussions/35517)
- **Build-time Image Optimization:** Process images during build, not runtime
  - Solves: [#19065](https://github.com/vercel/next.js/discussions/19065)
- **Self-hosted Only:** No edge/serverless compromises
  - Removes: Platform-exclusive features, artificial limitations, Vercel-first architecture (see [vendor-lock.md](vendor-lock.md))

<!-- ## Documentation

- **[Full Documentation](README.md):** Complete feature overview and philosophy
- **[Technical Details](CONTEXT.md):** Implementation specifics and migration guides
- **[GitHub Issues](https://github.com/openuiai/next.js/issues):** Bug reports and feature requests -->

## Contributing

This project is maintained by one committed developer, and **any help is welcome**. Whether you're fixing bugs, implementing features, improving documentation, or testing deployments — every contribution matters for building a truly self-hosted-first Next.js.

- **[Issues](https://github.com/openuiai/next.js/issues):** Bug reports and feature requests
- **[Pull Requests](https://github.com/openuiai/next.js/pulls):** Code contributions
- **[Discussions](https://github.com/openuiai/next.js/discussions):** Ideas and questions

## Community

- **[GitHub Discussions](https://github.com/openuiai/next.js/discussions):** Questions and ideas
- **[Discord](https://discord.gg/c6vdcZnw):** Real-time chat
- **[Twitter](https://twitter.com/celicoo):** Updates and announcements

---

**NOTE:** This fork is designed exclusively for self-hosted deployments. It will not work on serverless/edge platforms like Vercel by design.
