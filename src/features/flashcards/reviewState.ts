export const initialReview = { index: 0, revealed: false };
export function reviewState(
	state: typeof initialReview,
	action:
		| { type: "flip" }
		| { type: "move"; index: number }
		| { type: "hideAnswer" },
) {
	if (action.type === "flip") return { ...state, revealed: !state.revealed };
	if (action.type === "move")
		return { index: Math.max(0, action.index), revealed: false };
	return { ...state, revealed: false };
}
