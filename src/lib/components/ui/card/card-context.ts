import { getContext, setContext } from "svelte";
import type { CardSize, CardVariant } from "./card-variants.js";

/**
 * Shared state distributed by the Card root component to child slots.
 */
export interface CardContext {
	readonly variant: CardVariant;
	readonly size: CardSize;
	readonly selected: boolean;
}

const CARD_CONTEXT_KEY = Symbol("CARD_CONTEXT");

/**
 * Registers the Card context for descendant sub-components.
 *
 * @param ctx Card context object.
 */
export function setCardCtx(ctx: CardContext): void {
	setContext(CARD_CONTEXT_KEY, ctx);
}

/**
 * Retrieves the active Card context from an ancestor Card root.
 *
 * @return Card context or undefined when called outside a Card root.
 */
export function getCardCtx(): CardContext | undefined {
	return getContext<CardContext | undefined>(CARD_CONTEXT_KEY);
}
