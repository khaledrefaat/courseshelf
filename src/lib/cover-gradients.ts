export function coverGradient(id: number): string {
  const slot = ((((id - 1) % 8) + 8) % 8) + 1;
  return `linear-gradient(120deg, var(--cover-${slot}-from), var(--cover-${slot}-to))`;
}

export function coverLabel(title: string): string {
  return Array.from(title.trim().split(/\s+/)[0] || "Course")
    .slice(0, 7)
    .join("");
}
