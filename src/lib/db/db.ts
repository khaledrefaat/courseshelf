import Database from "@tauri-apps/plugin-sql";

let connection: Promise<Database> | undefined;

export function getDb(): Promise<Database> {
	connection ??= Database.load("sqlite:courseshelf.db")
		.then(async (db) => {
			// SQLx enables this for every SQLite pool connection by default.
			const [row] = await db.select<{ foreign_keys: number }[]>(
				"PRAGMA foreign_keys",
			);
			if (row?.foreign_keys !== 1) {
				throw new Error("SQLite foreign-key enforcement is disabled");
			}
			return db;
		})
		.catch((error: unknown) => {
			connection = undefined;
			throw error;
		});
	return connection;
}
