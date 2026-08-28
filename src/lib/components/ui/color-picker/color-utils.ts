export interface ColorPresetItem {
	label: string;
	color: string;
}

export interface ParsedColor {
	h: number;
	s: number;
	v: number;
	a: number;
	isNone: boolean;
}

export function normalizeToHex(color?: string, fallback = "#000000"): string {
	if (!color || color === "none" || color === "transparent") return fallback;
	if (color.startsWith("#")) {
		if (color.length === 7) return color.toUpperCase();
		if (color.length === 4) {
			return `#${color[1]}${color[1]}${color[2]}${color[2]}${color[3]}${color[3]}`.toUpperCase();
		}
		if (color.length === 9) {
			return color.slice(0, 7).toUpperCase();
		}
	}
	const match = color.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/i);
	if (match) {
		const r = parseInt(match[1], 10).toString(16).padStart(2, "0");
		const g = parseInt(match[2], 10).toString(16).padStart(2, "0");
		const b = parseInt(match[3], 10).toString(16).padStart(2, "0");
		return `#${r}${g}${b}`.toUpperCase();
	}
	return fallback;
}

export function hsvToRgb(h: number, s: number, v: number): { r: number; g: number; b: number } {
	const c = v * s;
	const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
	const m = v - c;
	let r = 0;
	let g = 0;
	let b = 0;
	if (h >= 0 && h < 60) {
		r = c;
		g = x;
		b = 0;
	} else if (h >= 60 && h < 120) {
		r = x;
		g = c;
		b = 0;
	} else if (h >= 120 && h < 180) {
		r = 0;
		g = c;
		b = x;
	} else if (h >= 180 && h < 240) {
		r = 0;
		g = x;
		b = c;
	} else if (h >= 240 && h < 300) {
		r = x;
		g = 0;
		b = c;
	} else {
		r = c;
		g = 0;
		b = x;
	}
	return {
		r: Math.round((r + m) * 255),
		g: Math.round((g + m) * 255),
		b: Math.round((b + m) * 255),
	};
}

export function rgbToHsv(r: number, g: number, b: number): { h: number; s: number; v: number } {
	const rNorm = r / 255;
	const gNorm = g / 255;
	const bNorm = b / 255;
	const max = Math.max(rNorm, gNorm, bNorm);
	const min = Math.min(rNorm, gNorm, bNorm);
	const d = max - min;
	let h = 0;
	if (d !== 0) {
		if (max === rNorm) {
			h = ((gNorm - bNorm) / d) % 6;
		} else if (max === gNorm) {
			h = (bNorm - rNorm) / d + 2;
		} else {
			h = (rNorm - gNorm) / d + 4;
		}
		h = Math.round(h * 60);
		if (h < 0) h += 360;
	}
	const s = max === 0 ? 0 : d / max;
	const v = max;
	return { h, s, v };
}

export function rgbToHex(r: number, g: number, b: number): string {
	return "#" + [r, g, b].map((x) => x.toString(16).padStart(2, "0")).join("").toUpperCase();
}

export function parseColorString(str?: string, noneValue = "transparent"): ParsedColor {
	if (!str || str === "none" || str === "transparent" || str === noneValue) {
		return { h: 0, s: 1, v: 1, a: 0, isNone: true };
	}
	const rgbaMatch = str.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?\)/i);
	if (rgbaMatch) {
		const r = parseInt(rgbaMatch[1], 10);
		const g = parseInt(rgbaMatch[2], 10);
		const b = parseInt(rgbaMatch[3], 10);
		const a = rgbaMatch[4] !== undefined ? parseFloat(rgbaMatch[4]) : 1;
		const { h, s, v } = rgbToHsv(r, g, b);
		return { h, s, v, a, isNone: false };
	}
	if (str.startsWith("#")) {
		let hex = str.slice(1);
		if (hex.length === 3) {
			hex = hex.split("").map((c) => c + c).join("");
		}
		if (hex.length === 6) {
			const r = parseInt(hex.slice(0, 2), 16);
			const g = parseInt(hex.slice(2, 4), 16);
			const b = parseInt(hex.slice(4, 6), 16);
			const { h, s, v } = rgbToHsv(r, g, b);
			return { h, s, v, a: 1, isNone: false };
		}
		if (hex.length === 8) {
			const r = parseInt(hex.slice(0, 2), 16);
			const g = parseInt(hex.slice(2, 4), 16);
			const b = parseInt(hex.slice(4, 6), 16);
			const a = parseInt(hex.slice(6, 8), 16) / 255;
			const { h, s, v } = rgbToHsv(r, g, b);
			return { h, s, v, a, isNone: false };
		}
	}
	return { h: 0, s: 1, v: 1, a: 1, isNone: false };
}
