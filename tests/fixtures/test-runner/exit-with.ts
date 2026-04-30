// Exits with the integer code passed as argv[2]. Default 0.
const code = Number.parseInt(process.argv[2] ?? '0', 10)
process.exit(Number.isFinite(code) ? code : 1)
export {}
