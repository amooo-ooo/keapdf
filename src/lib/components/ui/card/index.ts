import Root, { type CardRootProps } from "./card.svelte";
import Header, { type CardHeaderProps } from "./card-header.svelte";
import Title, { type CardTitleProps } from "./card-title.svelte";
import Description, { type CardDescriptionProps } from "./card-description.svelte";
import Actions, { type CardActionsProps } from "./card-actions.svelte";
import Content, { type CardContentProps } from "./card-content.svelte";
import Footer, { type CardFooterProps } from "./card-footer.svelte";
import {
	cardVariants,
	cardHeaderVariants,
	cardTitleVariants,
	cardDescriptionVariants,
	cardActionsVariants,
	cardContentVariants,
	cardFooterVariants,
	type CardVariant,
	type CardSize,
} from "./card-variants.js";
import {
	getCardCtx,
	setCardCtx,
	type CardContext,
} from "./card-context.js";

export {
	Root,
	Header,
	Title,
	Description,
	Actions,
	Actions as Action,
	Content,
	Footer,
	Root as Card,
	Root as CardRoot,
	Header as CardHeader,
	Title as CardTitle,
	Description as CardDescription,
	Actions as CardActions,
	Actions as CardAction,
	Content as CardContent,
	Footer as CardFooter,
	cardVariants,
	cardHeaderVariants,
	cardTitleVariants,
	cardDescriptionVariants,
	cardActionsVariants,
	cardContentVariants,
	cardFooterVariants,
	getCardCtx,
	setCardCtx,
	type CardRootProps,
	type CardHeaderProps,
	type CardTitleProps,
	type CardDescriptionProps,
	type CardActionsProps,
	type CardContentProps,
	type CardFooterProps,
	type CardVariant,
	type CardSize,
	type CardContext,
};
