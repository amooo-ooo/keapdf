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
