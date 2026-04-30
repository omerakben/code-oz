// Writes argv[2] kibibytes of 'a' to stdout (default 1 MiB), then exits.
const kib = Number.parseInt(process.argv[2] ?? '1024', 10)
const chunk = 'a'.repeat(1024)
for (let i = 0; i < kib; i++) process.stdout.write(chunk)
process.exit(0)
export {}
