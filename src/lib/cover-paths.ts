// Only Windows roots interpret backslashes as separators. A Unix filename with a
// backslash must not be silently redirected to a different file during cleanup.
function windowsPath(path: string): string {
	return path
		.replace(/\\/g, "/")
		.replace(/^\/\/\?\/UNC\//i, "//")
		.replace(/^\/\/\?\/(?=[a-z]:\/)/i, "");
}

export function resolveCoverPath(
	storedPath: string,
	dataDir: string,
): { path: string; relative: string } | null {
	const windows = /^[a-z]:[\\/]|^[\\/]{2}/i.test(dataDir);
	const normalize = windows ? windowsPath : (path: string) => path;
	const root = `${normalize(dataDir).replace(/\/+$/, "")}/covers/`;
	const stored = normalize(storedPath);
	const relative = stored.startsWith(root)
		? stored.slice(root.length)
		: stored.startsWith("/") || /^[a-z]:/i.test(stored)
			? ""
			: stored.replace(/^covers\//, "");
	const parts = relative.split("/");
	if (
		parts.some(
			(part) =>
				!part ||
				part === "." ||
				part === ".." ||
				/[\\\0]/.test(part) ||
				(windows && (/[<>:"|?*]/.test(part) || /[. ]$/.test(part))),
		)
	)
		return null;
	const separator = windows ? "\\" : "/";
	const nativeRoot = dataDir.replace(windows ? /[\\/]+$/ : /\/+$/, "");
	return {
		path: `${nativeRoot}${separator}covers${separator}${parts.join(separator)}`,
		relative,
	};
}
