/**
 * Pure TypeScript XML parser and node query utility.
 * Operates without DOMParser dependencies for complete test and runtime portability.
 */

export interface XmlNode {
  readonly tag: string;
  readonly localName: string;
  readonly attributes: Record<string, string>;
  readonly children: XmlNode[];
  text: string;
}

const TAG_REGEX = /<!--[\s\S]*?-->|<\?[\s\S]*?\?>|<!DOCTYPE[^>[]*(?:\[[\s\S]*?\]\s*)?>|<!\[CDATA\[([\s\S]*?)\]\]>|<(\/)?([a-zA-Z0-9_:.-]+)((?:\s+[a-zA-Z0-9_:.-]+(?:\s*=\s*(?:"[^<"]*"|'[^<']*'|[^\s/>]+))?)*)\s*(\/)?>|([^<]+)/g;
const ATTR_REGEX = /([a-zA-Z0-9_:.-]+)(?:\s*=\s*(?:"([^<"]*)"|'([^<']*)'|([^\s/>]+)))?/g;
const ENTITY_REGEX = /&(?:(amp|lt|gt|quot|apos|nbsp)|#x([0-9a-fA-F]+)|#([0-9]+));/g;

/**
 * Decodes XML character references and predefined entities in a single pass.
 * Prevents double-decoding vulnerabilities and properly preserves astral code points.
 */
export function decodeXmlEntities(input: string): string {
  if (!input.includes('&')) return input;

  return input.replace(ENTITY_REGEX, (match, named, hex, dec) => {
    if (named) {
      switch (named) {
        case 'amp': return '&';
        case 'lt': return '<';
        case 'gt': return '>';
        case 'quot': return '"';
        case 'apos': return "'";
        case 'nbsp': return '\u00A0';
        default: return match;
      }
    }
    if (hex) {
      const code = parseInt(hex, 16);
      return isNaN(code) || code <= 0 || code > 0x10FFFF ? '' : String.fromCodePoint(code);
    }
    if (dec) {
      const code = parseInt(dec, 10);
      return isNaN(code) || code <= 0 || code > 0x10FFFF ? '' : String.fromCodePoint(code);
    }
    return match;
  });
}

/**
 * Parses an XML string into a structured node hierarchy.
 * Resilient against malformed tags, unclosed quotes, and namespace discrepancies.
 */
export function parseXml(xml: string): XmlNode {
  const root: XmlNode = {
    tag: '#root',
    localName: '#root',
    attributes: Object.create(null) as Record<string, string>,
    children: [],
    text: '',
  };

  if (!xml || typeof xml !== 'string') {
    return root;
  }

  const stack: XmlNode[] = [root];
  TAG_REGEX.lastIndex = 0;

  let match: RegExpExecArray | null;
  while ((match = TAG_REGEX.exec(xml)) !== null) {
    const [
      fullMatch,
      cdataContent,
      isClosingSlash,
      tagName,
      rawAttributes,
      isSelfClosingSlash,
      textContent,
    ] = match;

    const currentParent = stack[stack.length - 1];

    if (cdataContent !== undefined) {
      // CDATA block: literal text preserved without entity decoding
      currentParent.text += cdataContent;
    } else if (textContent !== undefined) {
      // Plain text outside tags
      const decodedText = decodeXmlEntities(textContent);
      if (decodedText.length > 0) {
        currentParent.text += decodedText;
      }
    } else if (tagName) {
      const isClosing = isClosingSlash === '/';
      const isSelfClosing = isSelfClosingSlash === '/' || fullMatch.endsWith('/>');

      if (isClosing) {
        // Closing tag: extract local name for relaxed matching
        const colonIdx = tagName.indexOf(':');
        const closingLocal = colonIdx !== -1 ? tagName.slice(colonIdx + 1) : tagName;

        // Try exact qualified name match first
        let targetIdx = -1;
        for (let i = stack.length - 1; i > 0; i--) {
          if (stack[i].tag === tagName) {
            targetIdx = i;
            break;
          }
        }
        // Fall back to local name match if exact match not found
        if (targetIdx === -1) {
          for (let i = stack.length - 1; i > 0; i--) {
            if (stack[i].localName === closingLocal) {
              targetIdx = i;
              break;
            }
          }
        }

        if (targetIdx !== -1) {
          stack.length = targetIdx;
        }
      } else {
        // Opening tag
        const colonIndex = tagName.indexOf(':');
        const localName = colonIndex !== -1 ? tagName.slice(colonIndex + 1) : tagName;
        const attributes: Record<string, string> = Object.create(null);

        if (rawAttributes) {
          ATTR_REGEX.lastIndex = 0;
          let attrMatch: RegExpExecArray | null;
          while ((attrMatch = ATTR_REGEX.exec(rawAttributes)) !== null) {
            const attrKey = attrMatch[1];
            const rawVal = attrMatch[2] ?? attrMatch[3] ?? attrMatch[4];
            attributes[attrKey] = rawVal !== undefined ? decodeXmlEntities(rawVal) : attrKey;
          }
        }

        const node: XmlNode = {
          tag: tagName,
          localName,
          attributes,
          children: [],
          text: '',
        };

        currentParent.children.push(node);

        if (!isSelfClosing) {
          stack.push(node);
        }
      }
    }
  }

  // Return the single document element, or the root container if empty or multi-root
  return root.children.length === 1 ? root.children[0] : root;
}

/**
 * Finds all descendant nodes matching the given tag or local name using iterative traversal.
 * Avoids call stack overflow on deep hierarchies.
 */
export function findDescendants(node: XmlNode, targetTagOrLocal: string): XmlNode[] {
  const matches: XmlNode[] = [];
  const search = targetTagOrLocal.toLowerCase();
  const queue: XmlNode[] = [...node.children];

  while (queue.length > 0) {
    const current = queue.shift()!;
    if (
      current.tag === targetTagOrLocal ||
      current.localName === targetTagOrLocal ||
      current.tag.toLowerCase() === search ||
      current.localName.toLowerCase() === search
    ) {
      matches.push(current);
    }
    for (let i = 0; i < current.children.length; i++) {
      queue.push(current.children[i]);
    }
  }

  return matches;
}

/**
 * Finds direct children matching the given tag or local name.
 */
export function findChildren(node: XmlNode, targetTagOrLocal: string): XmlNode[] {
  const search = targetTagOrLocal.toLowerCase();
  return node.children.filter(
    (c) =>
      c.tag === targetTagOrLocal ||
      c.localName === targetTagOrLocal ||
      c.tag.toLowerCase() === search ||
      c.localName.toLowerCase() === search
  );
}

/**
 * Finds the first descendant matching the given tag or local name using iterative traversal.
 */
export function findFirstDescendant(
  node: XmlNode,
  targetTagOrLocal: string
): XmlNode | undefined {
  const search = targetTagOrLocal.toLowerCase();
  const queue: XmlNode[] = [...node.children];

  while (queue.length > 0) {
    const current = queue.shift()!;
    if (
      current.tag === targetTagOrLocal ||
      current.localName === targetTagOrLocal ||
      current.tag.toLowerCase() === search ||
      current.localName.toLowerCase() === search
    ) {
      return current;
    }
    for (let i = 0; i < current.children.length; i++) {
      queue.push(current.children[i]);
    }
  }

  return undefined;
}

/**
 * Finds the first direct child matching the given tag or local name.
 */
export function findFirstChild(
  node: XmlNode,
  targetTagOrLocal: string
): XmlNode | undefined {
  const search = targetTagOrLocal.toLowerCase();
  return node.children.find(
    (c) =>
      c.tag === targetTagOrLocal ||
      c.localName === targetTagOrLocal ||
      c.tag.toLowerCase() === search ||
      c.localName.toLowerCase() === search
  );
}

/**
 * Recursively extracts and concatenates all text inside a node.
 * Trims only at the outermost root call to preserve inter-run word spacing.
 */
export function getAllText(node: XmlNode): string {
  function collect(current: XmlNode): string {
    let result = current.text;
    for (let i = 0; i < current.children.length; i++) {
      result += collect(current.children[i]);
    }
    return result;
  }

  return collect(node).trim();
}

/**
 * Looks up an attribute value by full key or local name.
 * Prioritises exact and full name matches before falling back to local names.
 */
export function getAttribute(node: XmlNode, keyOrLocal: string): string | undefined {
  if (node.attributes[keyOrLocal] !== undefined) {
    return node.attributes[keyOrLocal];
  }

  const search = keyOrLocal.toLowerCase();

  // Phase 1: Case-insensitive full attribute key match
  for (const [k, v] of Object.entries(node.attributes)) {
    if (k.toLowerCase() === search) {
      return v;
    }
  }

  // Phase 2: Case-insensitive local name match
  for (const [k, v] of Object.entries(node.attributes)) {
    const colon = k.indexOf(':');
    if (colon !== -1 && k.slice(colon + 1).toLowerCase() === search) {
      return v;
    }
  }

  return undefined;
}
