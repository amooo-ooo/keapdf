/**
 * Fast style, variant, and design token search utility.
 *
 * Scans stylesheets, component definitions, and Svelte templates across the
 * codebase to locate definitions and usages without external dependencies.
 */

import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

export type DefinitionKind =
  | 'css-class'
  | 'css-token'
  | 'tv-fn'
  | 'tv-variant'
  | 'tv-prop'
  | 'tv-base';

export type UsageKind =
  | 'html-class'
  | 'variant-prop'
  | 'css-var-ref'
  | 'script-ref'
  | 'css-class';

export interface StyleMatch {
  file: string;
  line: number;
  column: number;
  category: 'definition' | 'usage';
  kind: DefinitionKind | UsageKind;
  detail?: string;
  codeSnippet: string;
}

export interface SearchOptions {
  query: string;
  exact: boolean;
  caseSensitive: boolean;
  defOnly: boolean;
  usageOnly: boolean;
  json: boolean;
}

export interface SearchResult {
  query: string;
  options: {
    exact: boolean;
    caseSensitive: boolean;
  };
  durationMs: number;
  filesScanned: number;
  definitions: StyleMatch[];
  usages: StyleMatch[];
}

const terminalColours = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',
  cyan: '\x1b[36m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  red: '\x1b[31m',
  bgGreen: '\x1b[42m\x1b[30m',
};

const shouldUseColour = Boolean(process.stdout.isTTY) && !process.env.NO_COLOR;

function colourText(text: string, colourCode: string): string {
  if (!shouldUseColour) return text;
  return `${colourCode}${text}${terminalColours.reset}`;
}

export function parseArgs(args: string[]): SearchOptions | { help: true } {
  let query = '';
  let exact = false;
  let caseSensitive = false;
  let defOnly = false;
  let usageOnly = false;
  let json = false;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '-h' || arg === '--help') return { help: true };
    if (arg === '-e' || arg === '--exact') { exact = true; continue; }
    if (arg === '-c' || arg === '--case-sensitive') { caseSensitive = true; continue; }
    if (arg === '-d' || arg === '--def-only') { defOnly = true; continue; }
    if (arg === '-u' || arg === '--usage-only') { usageOnly = true; continue; }
    if (arg === '--json') { json = true; continue; }

    if (!query) {
      query = arg;
    }
  }

  return { query, exact, caseSensitive, defOnly, usageOnly, json };
}

export function escapeRegex(pattern: string): string {
  return pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function executeSearch(options: SearchOptions, rootDir: string = process.cwd()): SearchResult {
  const startTime = performance.now();
  const srcDir = path.resolve(rootDir, 'src');

  const glob = new Bun.Glob('**/*.{css,ts,svelte}');
  const fileEntries = Array.from(glob.scanSync({ cwd: srcDir, absolute: true })).sort();

  const rawQuery = options.query;
  const cleanQuery = rawQuery.replace(/^(--|\.)/, '');
  const escapedQuery = escapeRegex(cleanQuery);
  const regexFlags = options.caseSensitive ? 'g' : 'gi';

  let matchRegex: RegExp;
  if (options.exact) {
    matchRegex = new RegExp(`(?<![a-zA-Z0-9_-])(?:--|\\.)?${escapedQuery}(?![a-zA-Z0-9_-])`, regexFlags);
  } else {
    matchRegex = new RegExp(escapedQuery, regexFlags);
  }

  const definitions: StyleMatch[] = [];
  const usages: StyleMatch[] = [];

  for (const filePath of fileEntries) {
    const fileContent = fs.readFileSync(filePath, 'utf-8');
    const relativePath = path.relative(rootDir, filePath).replace(/\\/g, '/');
    const lines = fileContent.split('\n');
    const extension = path.extname(filePath);

    let inTvBlock = false;
    let tvBraceDepth = 0;
    let inStyleBlock = false;

    for (let lineIndex = 0; lineIndex < lines.length; lineIndex++) {
      const lineNumber = lineIndex + 1;
      const rawLine = lines[lineIndex];
      const trimmedLine = rawLine.trim();
      if (!trimmedLine) continue;

      if (extension === '.svelte') {
        if (trimmedLine.includes('<style>')) inStyleBlock = true;
        if (trimmedLine.includes('</style>')) inStyleBlock = false;
      }

      let isLineDefinition = false;

      if (extension === '.css' || inStyleBlock) {
        const tokenMatch = trimmedLine.match(/^(--[a-zA-Z0-9_-]+)\s*:/);
        if (tokenMatch) {
          const tokenName = tokenMatch[1];
          const tokenClean = tokenName.replace(/^--/, '');
          let isTokenMatch = false;
          if (options.exact) {
            isTokenMatch = options.caseSensitive
              ? tokenClean === cleanQuery || tokenName === rawQuery
              : tokenClean.toLowerCase() === cleanQuery.toLowerCase() || tokenName.toLowerCase() === rawQuery.toLowerCase();
          } else {
            isTokenMatch = options.caseSensitive
              ? tokenName.includes(cleanQuery)
              : tokenName.toLowerCase().includes(cleanQuery.toLowerCase());
          }

          if (isTokenMatch) {
            const columnNumber = rawLine.indexOf(tokenName) + 1;
            definitions.push({
              file: relativePath,
              line: lineNumber,
              column: columnNumber,
              category: 'definition',
              kind: 'css-token',
              detail: tokenName,
              codeSnippet: trimmedLine,
            });
            isLineDefinition = true;
          }
        }

        if (!isLineDefinition && !trimmedLine.startsWith('@apply') && !trimmedLine.startsWith('/*')) {
          const classMatches = Array.from(trimmedLine.matchAll(/(?:^|[,\s>+~:(])\.([a-zA-Z0-9_-]+)/g));
          for (const matchedClass of classMatches) {
            const className = matchedClass[1];
            let isClassMatch = false;
            if (options.exact) {
              isClassMatch = options.caseSensitive
                ? className === cleanQuery
                : className.toLowerCase() === cleanQuery.toLowerCase();
            } else {
              isClassMatch = options.caseSensitive
                ? className.includes(cleanQuery)
                : className.toLowerCase().includes(cleanQuery.toLowerCase());
            }

            if (isClassMatch) {
              const columnNumber = rawLine.indexOf('.' + className) + 1;
              definitions.push({
                file: relativePath,
                line: lineNumber,
                column: columnNumber,
                category: 'definition',
                kind: 'css-class',
                detail: `.${className}`,
                codeSnippet: trimmedLine,
              });
              isLineDefinition = true;
              break;
            }
          }
        }
      }

      if (extension === '.ts' || extension === '.svelte') {
        const tvFnMatch = trimmedLine.match(/(?:export\s+)?(?:const|let|var)\s+([a-zA-Z0-9_$]+)\s*=\s*tv\(/);
        if (tvFnMatch) {
          const functionName = tvFnMatch[1];
          let isFunctionMatch = false;
          if (options.exact) {
            isFunctionMatch = options.caseSensitive
              ? functionName === cleanQuery
              : functionName.toLowerCase() === cleanQuery.toLowerCase();
          } else {
            isFunctionMatch = options.caseSensitive
              ? functionName.includes(cleanQuery)
              : functionName.toLowerCase().includes(cleanQuery.toLowerCase());
          }
          if (isFunctionMatch) {
            const columnNumber = rawLine.indexOf(functionName) + 1;
            definitions.push({
              file: relativePath,
              line: lineNumber,
              column: columnNumber,
              category: 'definition',
              kind: 'tv-fn',
              detail: `tv definition "${functionName}"`,
              codeSnippet: trimmedLine,
            });
            isLineDefinition = true;
          }
        }

        if (trimmedLine.includes('tv({')) {
          inTvBlock = true;
          tvBraceDepth = 0;
        }

        if (inTvBlock) {
          const openBraces = (rawLine.match(/\{/g) || []).length;
          const closeBraces = (rawLine.match(/\}/g) || []).length;
          tvBraceDepth += openBraces - closeBraces;

          const baseMatch = trimmedLine.match(/base:\s*["'`]([^"'`]+)["'`]/);
          if (baseMatch) {
            const baseClasses = baseMatch[1].split(/\s+/);
            for (const baseClass of baseClasses) {
              let isBaseMatch = false;
              if (options.exact) {
                isBaseMatch = options.caseSensitive
                  ? baseClass === cleanQuery
                  : baseClass.toLowerCase() === cleanQuery.toLowerCase();
              } else {
                isBaseMatch = options.caseSensitive
                  ? baseClass.includes(cleanQuery)
                  : baseClass.toLowerCase().includes(cleanQuery.toLowerCase());
              }

              if (isBaseMatch) {
                const columnNumber = rawLine.indexOf(baseClass) + 1;
                definitions.push({
                  file: relativePath,
                  line: lineNumber,
                  column: columnNumber,
                  category: 'definition',
                  kind: 'tv-base',
                  detail: `base class "${baseClass}"`,
                  codeSnippet: trimmedLine,
                });
                isLineDefinition = true;
                break;
              }
            }
          }

          const groupMatch = trimmedLine.match(/^(['"]?)([a-zA-Z0-9_-]+)\1\s*:\s*\{/);
          if (groupMatch) {
            const groupName = groupMatch[2];
            if (
              groupName !== 'variants' &&
              groupName !== 'defaultVariants' &&
              groupName !== 'compoundVariants' &&
              groupName !== 'slots'
            ) {
              let isGroupMatch = false;
              if (options.exact) {
                isGroupMatch = options.caseSensitive
                  ? groupName === cleanQuery
                  : groupName.toLowerCase() === cleanQuery.toLowerCase();
              } else {
                isGroupMatch = options.caseSensitive
                  ? groupName.includes(cleanQuery)
                  : groupName.toLowerCase().includes(cleanQuery.toLowerCase());
              }

              if (isGroupMatch) {
                const columnNumber = rawLine.indexOf(groupName) + 1;
                definitions.push({
                  file: relativePath,
                  line: lineNumber,
                  column: columnNumber,
                  category: 'definition',
                  kind: 'tv-prop',
                  detail: `variant prop "${groupName}"`,
                  codeSnippet: trimmedLine,
                });
                isLineDefinition = true;
              }
            }
          }

          const variantKeyMatch = trimmedLine.match(/^(['"]?)([a-zA-Z0-9_-]+)\1\s*:\s*["'`]/);
          if (variantKeyMatch) {
            const variantKey = variantKeyMatch[2];
            if (
              variantKey !== 'base' &&
              variantKey !== 'variants' &&
              variantKey !== 'defaultVariants' &&
              variantKey !== 'compoundVariants' &&
              variantKey !== 'slots'
            ) {
              let isVariantMatch = false;
              if (options.exact) {
                isVariantMatch = options.caseSensitive
                  ? variantKey === cleanQuery
                  : variantKey.toLowerCase() === cleanQuery.toLowerCase();
              } else {
                isVariantMatch = options.caseSensitive
                  ? variantKey.includes(cleanQuery)
                  : variantKey.toLowerCase().includes(cleanQuery.toLowerCase());
              }

              if (isVariantMatch) {
                const columnNumber = rawLine.indexOf(variantKey) + 1;
                definitions.push({
                  file: relativePath,
                  line: lineNumber,
                  column: columnNumber,
                  category: 'definition',
                  kind: 'tv-variant',
                  detail: `variant "${variantKey}"`,
                  codeSnippet: trimmedLine,
                });
                isLineDefinition = true;
              }
            }
          }

          if (tvBraceDepth <= 0 && trimmedLine.includes('})')) {
            inTvBlock = false;
          }
        }
      }

      if (!isLineDefinition) {
        matchRegex.lastIndex = 0;
        const matchedUsage = matchRegex.exec(rawLine);
        if (matchedUsage) {
          const matchIndex = matchedUsage.index;

          let usageKind: UsageKind = 'script-ref';
          if (extension === '.svelte' || extension === '.html') {
            if (rawLine.includes('variant=') || rawLine.includes('variant:')) {
              usageKind = 'variant-prop';
            } else if (rawLine.includes('class=') || rawLine.includes('class:') || rawLine.includes('class =')) {
              usageKind = 'html-class';
            } else if (rawLine.includes('var(--')) {
              usageKind = 'css-var-ref';
            }
          } else if (extension === '.css') {
            if (rawLine.includes('var(--')) {
              usageKind = 'css-var-ref';
            } else {
              usageKind = 'css-class';
            }
          } else {
            if (rawLine.includes('var(--')) {
              usageKind = 'css-var-ref';
            }
          }

          usages.push({
            file: relativePath,
            line: lineNumber,
            column: matchIndex + 1,
            category: 'usage',
            kind: usageKind,
            codeSnippet: trimmedLine,
          });
        }
      }
    }
  }

  const durationMs = Number((performance.now() - startTime).toFixed(2));

  return {
    query: rawQuery,
    options: {
      exact: options.exact,
      caseSensitive: options.caseSensitive,
    },
    durationMs,
    filesScanned: fileEntries.length,
    definitions,
    usages,
  };
}

export function formatTerminalOutput(result: SearchResult, options: SearchOptions): string {
  const outputLines: string[] = [];
  const defCount = result.definitions.length;
  const usageCount = result.usages.length;

  outputLines.push(
    `${colourText('Kea PDF Style Finder', terminalColours.bold + terminalColours.cyan)} ` +
    `${colourText(`"${result.query}"`, terminalColours.yellow + terminalColours.bold)} ` +
    `${colourText(`(${options.exact ? 'exact' : 'partial'}, ${result.durationMs}ms, ${result.filesScanned} files scanned)`, terminalColours.dim)}`
  );
  outputLines.push('');

  if (!options.usageOnly) {
    outputLines.push(
      colourText(`Definitions (${defCount})`, terminalColours.bold + terminalColours.green)
    );

    if (defCount === 0) {
      outputLines.push(colourText('  No definitions found in stylesheets or tv variants.', terminalColours.dim));
    } else {
      for (const def of result.definitions) {
        const badge = colourText(`[${def.kind.toUpperCase()}]`, terminalColours.bgGreen);
        const location = colourText(`${def.file}:${def.line}:${def.column}`, terminalColours.cyan);
        const detail = def.detail ? colourText(` (${def.detail})`, terminalColours.dim) : '';
        outputLines.push(`  ${badge} ${location}${detail}`);
        outputLines.push(`    ${colourText(`${def.line.toString().padStart(4, ' ')} |`, terminalColours.dim)} ${def.codeSnippet}`);
      }
    }
    outputLines.push('');
  }

  if (!options.defOnly) {
    outputLines.push(
      colourText(`Usages (${usageCount})`, terminalColours.bold + terminalColours.blue)
    );

    if (usageCount === 0) {
      outputLines.push(colourText('  No usages found across components or scripts.', terminalColours.dim));
    } else {
      const usagesByFile = new Map<string, StyleMatch[]>();
      for (const usage of result.usages) {
        const fileList = usagesByFile.get(usage.file) || [];
        fileList.push(usage);
        usagesByFile.set(usage.file, fileList);
      }

      for (const [file, items] of usagesByFile) {
        outputLines.push(
          `  ${colourText(file, terminalColours.bold + terminalColours.cyan)} ` +
          colourText(`(${items.length} ${items.length === 1 ? 'usage' : 'usages'})`, terminalColours.dim)
        );
        for (const item of items) {
          outputLines.push(`    ${colourText(`${item.line.toString().padStart(4, ' ')} |`, terminalColours.dim)} ${item.codeSnippet}`);
        }
      }
    }
    outputLines.push('');
  }

  outputLines.push(
    colourText(
      `Summary: ${defCount} definition${defCount === 1 ? '' : 's'}, ` +
      `${usageCount} usage${usageCount === 1 ? '' : 's'} ` +
      `across ${new Set([...result.definitions, ...result.usages].map((item) => item.file)).size} file(s).`,
      terminalColours.bold
    )
  );

  return outputLines.join('\n');
}

export function printHelp(): void {
  console.log(`
${colourText('find-style', terminalColours.bold + terminalColours.cyan)}: Fast style, variant, and token search across Kea PDF codebase.

${colourText('USAGE:', terminalColours.bold)}
  bun run find-style <query> [options]
  bun scripts/find-style.ts <query> [options]

${colourText('ARGUMENTS:', terminalColours.bold)}
  <query>                  CSS class name, variant name, or CSS variable token
                           (e.g., panel, field-group, --sidebar-bento-bg)

${colourText('OPTIONS:', terminalColours.bold)}
  -e, --exact              Exact match on class, variant, or token name (boundary-aware)
  -c, --case-sensitive     Case-sensitive matching (default: case-insensitive)
  -d, --def-only           Output definitions only
  -u, --usage-only         Output usages only
  --json                   Output results in structured JSON format
  -h, --help               Show this help message

${colourText('EXAMPLES:', terminalColours.bold)}
  bun run find-style panel
  bun run find-style field-group -e
  bun run find-style --sidebar-bento-bg
  bun run find-style compact -d
  bun run find-style panel --json
`);
}

if (import.meta.main) {
  const parsed = parseArgs(process.argv.slice(2));

  if ('help' in parsed) {
    printHelp();
    process.exit(0);
  }

  if (!parsed.query) {
    console.error(colourText('Error: Missing search query.', terminalColours.red));
    console.error('Usage: bun run find-style <query> [options]');
    console.error('Run with --help for full usage information.');
    process.exit(1);
  }

  const result = executeSearch(parsed);

  if (parsed.json) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    console.log(formatTerminalOutput(result, parsed));
  }
}
