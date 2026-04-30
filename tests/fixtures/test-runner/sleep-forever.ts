// Sleeps until killed. The test runner's timeout is the only way out.
await new Promise<never>(() => {})
export {}
