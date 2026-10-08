/**
 * Primitive UI components design system barrel export.
 *
 * Exposes core UI components, variant recipes, and the type-safe component
 * variants specification manifest with complete type safety.
 */

export * from './variants-manifest.js';

export {
	Button,
	buttonVariants,
	type ButtonProps,
	type ButtonSize,
	type ButtonVariant,
} from './button/index.js';

export {
	Badge,
	badgeVariants,
	type BadgeVariant,
} from './badge/index.js';

export {
	ButtonGroup,
	buttonGroupVariants,
	type ButtonGroupVariantProps,
	type ButtonGroupContext,
	type ButtonGroupValue,
	getButtonGroupCtx,
	setButtonGroupCtx,
} from './button-group/index.js';

export {
	ControlRow,
	controlRowVariants,
	type ControlRowVariant,
	type ControlRowSize,
} from './control-row/index.js';

export {
	PropertyRow,
	type PropertyRowProps,
} from './property-row/index.js';

export {
	PropertyCard,
	type PropertyCardProps,
} from './property-card/index.js';

export {
	PropertySection,
	type PropertySectionProps,
} from './property-section/index.js';

export {
	Input,
} from './input/index.js';

export {
	Textarea,
} from './textarea/index.js';

export {
	Toggle,
	toggleVariants,
	type ToggleVariant,
	type ToggleSize,
} from './toggle/index.js';

export {
	ToggleGroup,
	ToggleGroupItem,
} from './toggle-group/index.js';

export {
	Checkbox,
} from './checkbox/index.js';

export {
	Switch,
} from './switch/index.js';

export {
	Slider,
	sliderVariants,
	type SliderVariant,
	type SliderSize,
	type SliderRootProps,
} from './slider/index.js';

export {
	Label,
	labelVariants,
	type LabelSize,
} from './label/index.js';

export {
	ColorPicker,
} from './color-picker/index.js';

export {
	Select,
	SelectContent,
	SelectGroup,
	SelectGroupHeading,
	SelectItem,
	SelectLabel,
	SelectPortal,
	SelectScrollDownButton,
	SelectScrollUpButton,
	SelectSeparator,
	SelectTrigger,
	type SelectTriggerVariant,
	type SelectTriggerProps,
} from './select/index.js';

export {
	Tabs,
	TabsContent,
	TabsList,
	TabsTrigger,
	tabsListVariants,
	type TabsListVariant,
} from './tabs/index.js';

export {
	Dialog,
	DialogClose,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogOverlay,
	DialogPortal,
	DialogTitle,
	DialogTrigger,
} from './dialog/index.js';

export {
	DropdownMenu,
	DropdownMenuCheckboxItem,
	DropdownMenuContent,
	DropdownMenuGroup,
	DropdownMenuItem,
	DropdownMenuLabel,
	DropdownMenuPortal,
	DropdownMenuRadioGroup,
	DropdownMenuRadioItem,
	DropdownMenuSeparator,
	DropdownMenuShortcut,
	DropdownMenuSub,
	DropdownMenuSubContent,
	DropdownMenuSubTrigger,
	DropdownMenuTrigger,
} from './dropdown-menu/index.js';

export {
	DropdownButton,
	dropdownButtonVariants,
	dropdownSplitRootVariants,
	dropdownSplitActionVariants,
	dropdownSplitTriggerVariants,
	DROPDOWN_BUTTON_FILL_CLASSES,
	DROPDOWN_BUTTON_DIVIDER_CLASSES,
	type DropdownButtonProps,
	type DropdownButtonVariant,
	type DropdownButtonSize,
	type DropdownButtonFillColor,
} from './dropdown-button/index.js';

export {
	Popover,
	PopoverClose,
	PopoverContent,
	PopoverTrigger,
} from './popover/index.js';

export {
	Tooltip,
	TooltipContent,
	TooltipProvider,
	TooltipTrigger,
} from './tooltip/index.js';

export {
	Separator,
} from './separator/index.js';

export {
	ScrollArea,
} from './scroll-area/index.js';

export {
	ResizableHandle,
	ResizablePane,
	ResizablePaneGroup,
} from './resizable/index.js';

export {
	Carousel,
	CarouselContent,
	CarouselItem,
	CarouselIndicators,
	CarouselPrevious,
	CarouselNext,
	carouselVariants,
	clampSlideIndex,
	resolveNextSlideIndex,
	resolvePreviousSlideIndex,
	canNavigatePrevious,
	canNavigateNext,
	getCarouselCtx,
	setCarouselCtx,
	type CarouselRootProps,
	type CarouselContentProps,
	type CarouselItemProps,
	type CarouselIndicatorsProps,
	type CarouselPreviousProps,
	type CarouselNextProps,
	type CarouselVariant,
	type CarouselSize,
	type CarouselOrientation,
	type CarouselContext,
} from './carousel/index.js';

export {
	Card,
	CardRoot,
	CardHeader,
	CardTitle,
	CardDescription,
	CardActions,
	CardAction,
	CardContent,
	CardFooter,
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
} from './card/index.js';

