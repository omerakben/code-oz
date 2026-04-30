// Writes argv[2] kibibytes of 'b' to stderr (default 1 MiB), then exits.
const kib = Number.parseInt(process.argv[2] ?? '1024', 10)
const chunk = 'b'.repeat(1024)
for (let i = 0; i < kib; i++) process.stderr.write(chunk)
process.exit(0)
export {}
