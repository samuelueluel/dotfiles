/**
 * blackhole renders its observational-memory gauges even when memory:false
 * leaves them dead: O pegs full (no pass ever drains it) and P stays empty.
 * When observation memory is enabled, the gauges are live and must pass
 * through untouched.
 *
 * Shape assumptions (pi-blackhole 0.5.9): each dead gauge is a bare letter,
 * then one or more SGR runs, then a bar delimited by ▕ (U+2595) … ▏ (U+258F)
 * containing only SGR runs and █/░ cells. Segment separators are two spaces.
 * Anything unrecognized passes through unchanged.
 */
export function trimBlackholeStatus(
	text: string,
	options: { dropObservationGauges?: boolean } = {},
): string {
	if (!options.dropObservationGauges) return text;
	const trimmed = text.replace(
		/(?:\x1b\[[0-9;]*m)+[OP](?:\x1b\[[0-9;]*m)+▕(?:\x1b\[[0-9;]*m|[█░])*▏/g,
		"",
	);
	if (trimmed === text) return text;
	// Collapse separator runs of 3+ visible spaces (SGR runs may interleave).
	return trimmed.replace(/(?: {1,}|\x1b\[[0-9;]*m)+/g, (run) => {
		const spaces = (run.match(/ /g) ?? []).length;
		return spaces >= 3 ? "  " : run;
	}).trim();
}

/** Interpret the blackhole config's `memory` field: true unless clearly off. */
export function isObservationMemoryEnabled(memory: unknown): boolean {
	return !(memory === false || memory === "false" || memory === "off" || memory === "no");
}
