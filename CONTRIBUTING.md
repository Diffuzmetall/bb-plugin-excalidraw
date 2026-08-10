# Contributing

1. Fork the repository and create a focused branch.
2. Install dependencies with `npm install`.
3. Run `npm run check`.
4. Run `npm run test:browser` for canvas, accessibility, link-policy, or scene-serialization changes.
5. Describe user-visible behavior and compatibility implications in the pull request.

Keep workspace authority on the server side. Do not add force writes, raw file inputs, generic JSON/image openers, sidecar processes, or model-facing image bodies.

When changing scene limits, CLI arguments, tool schemas, or BB Plugin SDK compatibility, update the README and tests in the same pull request.
