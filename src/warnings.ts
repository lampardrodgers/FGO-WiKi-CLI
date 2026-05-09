export function installSqliteWarningFilter(): void {
  process.on("warning", (warning) => {
    if (warning.name === "ExperimentalWarning" && warning.message.includes("SQLite")) return;
    process.stderr.write(`${warning.name}: ${warning.message}\n`);
  });
}

